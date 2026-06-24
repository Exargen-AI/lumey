import PDFDocument from 'pdfkit';
import type { Response } from 'express';
import prisma from '../config/database';
import { NotFoundError } from '../utils/errors';

// Generates a PDF receipt for an enrollment — the artifact you give to legal
// counsel or store offline. Streams directly to the response so we don't have
// to buffer the whole document in memory.
//
// The PDF includes, per signed document:
//   - Document title + version + slug
//   - Server-side signedAt timestamp
//   - Typed legal name
//   - IP address + user agent
//   - The FULL agreed text (`signedTextSnapshot`) — the legally-meaningful artifact
//
// Plus enrollment header:
//   - Course title + version at sign time
//   - User name + email + role
//   - Enrollment + completion timestamps
//   - All quiz attempts with score + pass/fail

// Shape we need to render a receipt. Pulled out so callers can supply a
// pre-fetched enrollment (e.g. inside the archive sweep) without paying for
// a second DB round-trip per row.
type ReceiptInclude = Awaited<ReturnType<typeof fetchEnrollmentForReceipt>>;

async function fetchEnrollmentForReceipt(enrollmentId: string) {
  const enrollment = await prisma.enrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      course: true,
      signatures: {
        include: { courseDocument: true },
        orderBy: { signedAt: 'asc' },
      },
      quizAttempts: {
        include: { quiz: { include: { module: { select: { id: true, title: true, order: true } } } } },
        orderBy: { startedAt: 'asc' },
      },
    },
  });
  if (!enrollment) throw new NotFoundError('Enrollment');
  return enrollment;
}

export async function streamEnrollmentReceipt(enrollmentId: string, res: Response) {
  const enrollment = await fetchEnrollmentForReceipt(enrollmentId);

  const filename = `onboarding-receipt-${enrollment.user.name.replace(/\s+/g, '_')}-${enrollment.course.slug}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const doc = newReceiptDoc(enrollment);
  doc.pipe(res);
  renderEnrollmentToPdf(doc, enrollment);
  doc.end();
}

function newReceiptDoc(enrollment: ReceiptInclude) {
  return new PDFDocument({
    size: 'A4',
    margin: 56,
    info: {
      Title: `Onboarding Receipt — ${enrollment.user.name} — ${enrollment.course.title}`,
      Author: 'Exargen',
      Subject: `Compliance training completion record for ${enrollment.user.email}`,
    },
  });
}

// Renders one enrollment receipt into an already-constructed PDFDocument.
// Caller owns the doc lifecycle (piping + end()) so the same renderer can
// drive single-PDF downloads AND zip-archive entries.
function renderEnrollmentToPdf(doc: PDFKit.PDFDocument, enrollment: ReceiptInclude) {
  // ── Header ──
  doc
    .fillColor('#1f2937')
    .fontSize(18)
    .font('Helvetica-Bold')
    .text('Onboarding Compliance Receipt', { align: 'left' });
  doc.moveDown(0.3);
  doc
    .fontSize(9)
    .fillColor('#6b7280')
    .font('Helvetica')
    .text(
      'This document is a permanent legal record of compliance training completion and per-policy signature. ' +
        'Signatures below are pinned with full text snapshot, IP address, and server-side timestamp.',
      { align: 'left' },
    );
  doc.moveDown(0.8);

  // Horizontal rule
  doc.moveTo(56, doc.y).lineTo(539, doc.y).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveDown(0.6);

  // ── Subject ──
  kvSection(doc, 'Subject', [
    ['Name', enrollment.user.name],
    ['Email', enrollment.user.email],
    ['Role', enrollment.user.role],
    ['User ID', enrollment.user.id],
  ]);

  // ── Course ──
  kvSection(doc, 'Course', [
    ['Title', enrollment.course.title],
    ['Slug', enrollment.course.slug],
    ['Version at completion', String(enrollment.courseVersion)],
    ['Current course version', String(enrollment.course.version)],
    ['Enrolled at', formatTs(enrollment.enrolledAt)],
    ['Completed at', enrollment.completedAt ? formatTs(enrollment.completedAt) : '—'],
    ['Declined at', enrollment.declinedAt ? formatTs(enrollment.declinedAt) : '—'],
  ]);

  // ── Quiz attempts summary ──
  if (enrollment.quizAttempts.length > 0) {
    sectionHeader(doc, 'Comprehension quiz attempts');
    doc.fontSize(9).font('Helvetica');
    enrollment.quizAttempts.forEach((a) => {
      const moduleLabel = `Module ${a.quiz.module.order} — ${a.quiz.module.title}`;
      const scoreLabel =
        a.scorePercent !== null ? `${a.scorePercent}% — ${a.passed ? 'PASSED' : 'FAILED'}` : 'INCOMPLETE';
      doc.fillColor('#374151').text(`#${a.attemptNumber}  ${moduleLabel}`, { continued: false });
      doc
        .fillColor('#6b7280')
        .text(`  ${formatTs(a.startedAt)}  →  ${scoreLabel}`, { indent: 12 });
    });
    doc.moveDown(0.8);
  }

  // ── Signatures (one section per document) ──
  if (enrollment.signatures.length === 0) {
    sectionHeader(doc, 'Signatures');
    doc.fontSize(10).fillColor('#6b7280').font('Helvetica').text('No signatures recorded.');
  } else {
    enrollment.signatures.forEach((sig, i) => {
      sectionHeader(doc, `Signature ${i + 1} of ${enrollment.signatures.length} — ${sig.courseDocument.title}`);

      kvBlock(doc, [
        ['Document slug', sig.courseDocument.slug],
        ['Document version', String(sig.documentVersion)],
        ['Signed at', formatTs(sig.signedAt)],
        ['Signed name', sig.signedName],
        ['IP address', sig.ipAddress ?? '—'],
        ['User agent', sig.userAgent ?? '—'],
        ['Identity ritual', sig.passwordReentered ? 'Typed name + password re-entry' : sig.externalProvider ? `External: ${sig.externalProvider}` : 'Typed name only'],
        ...(sig.externalEnvelopeId ? [['External envelope ID', sig.externalEnvelopeId] as [string, string]] : []),
      ]);

      doc.fontSize(9).fillColor('#374151').font('Helvetica-Bold').text('Agreed text (snapshot at sign time)');
      doc.moveDown(0.3);
      doc.fontSize(8.5).fillColor('#1f2937').font('Helvetica');
      // Box around the snapshot for visual separation.
      const snapshotStart = doc.y;
      doc.text(sig.signedTextSnapshot, { align: 'left', width: 483, indent: 8 });
      const snapshotEnd = doc.y;
      doc
        .strokeColor('#e5e7eb')
        .lineWidth(0.5)
        .rect(56, snapshotStart - 4, 483, snapshotEnd - snapshotStart + 8)
        .stroke();
      doc.moveDown(1.0);
    });
  }

  // ── Footer ──
  const generatedAt = new Date();
  doc.fontSize(8).fillColor('#9ca3af').font('Helvetica');
  doc.text(`Generated ${formatTs(generatedAt)} — receipt id ${enrollment.id}`, { align: 'center' });
}

function sectionHeader(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.4);
  doc.fontSize(11).fillColor('#111827').font('Helvetica-Bold').text(title);
  doc.moveTo(56, doc.y + 1).lineTo(539, doc.y + 1).strokeColor('#e5e7eb').lineWidth(0.5).stroke();
  doc.moveDown(0.4);
}

function kvBlock(doc: PDFKit.PDFDocument, rows: Array<[string, string]>) {
  doc.fontSize(9.5).font('Helvetica');
  rows.forEach(([k, v]) => {
    doc.fillColor('#6b7280').text(`${k}:`, { continued: true });
    doc.fillColor('#1f2937').text(`  ${v}`);
  });
  doc.moveDown(0.4);
}

function kvSection(doc: PDFKit.PDFDocument, title: string, rows: Array<[string, string]>) {
  sectionHeader(doc, title);
  kvBlock(doc, rows);
}

function formatTs(d: Date): string {
  return new Date(d).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}
