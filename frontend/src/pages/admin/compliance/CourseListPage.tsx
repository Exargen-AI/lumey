import { Link } from 'react-router-dom';
import { ShieldCheck, FileText, Users } from 'lucide-react';
import { useAdminCourses } from '@/hooks/useAdminCompliance';
import { formatDate } from '@/lib/formatters';
import { cn } from '@/lib/cn';

const STATUS_TONE: Record<string, string> = {
  PUBLISHED: 'bg-green-100 text-green-700 border-green-200',
  DRAFT: 'bg-gray-100 text-gray-700 border-gray-200',
  ARCHIVED: 'bg-amber-100 text-amber-700 border-amber-200',
};

export function ComplianceCourseListPage() {
  const { data: courses, isLoading } = useAdminCourses();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Compliance Courses</h1>
          <p className="mt-1 text-sm text-gray-500">
            NDA, IP, conduct & security training. Edit document text here when policies change — bumping a course version automatically re-prompts every employee on next login.
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-gray-400">Loading…</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses?.map((c) => {
          const completionPct =
            c.counts.totalEnrollments > 0
              ? Math.round((c.counts.completed / c.counts.totalEnrollments) * 100)
              : 0;
          return (
            <Link
              key={c.id}
              to={`/compliance/courses/${c.id}`}
              className="group block rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-5 hover:shadow-md transition"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={16} className="text-indigo-500" />
                    <h2 className="font-semibold text-gray-900 dark:text-gray-100 group-hover:text-indigo-600">
                      {c.title}
                    </h2>
                  </div>
                  <p className="mt-0.5 text-xs text-gray-500">
                    v{c.version} · {c.slug}
                  </p>
                </div>
                <span
                  className={cn(
                    'text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full border',
                    STATUS_TONE[c.status] ?? STATUS_TONE.DRAFT,
                  )}
                >
                  {c.status}
                </span>
              </div>

              {c.description && (
                <p className="mt-2 text-xs text-gray-600 dark:text-gray-400 line-clamp-2">
                  {c.description}
                </p>
              )}

              <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
                <Stat icon={<FileText size={12} />} label="Modules" value={c.counts.modules} />
                <Stat icon={<FileText size={12} />} label="Documents" value={c.counts.documents} />
                <Stat icon={<Users size={12} />} label="Enrolled" value={c.counts.totalEnrollments} />
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] text-gray-500 mb-1">
                  <span>Completion</span>
                  <span className="font-medium text-gray-700 dark:text-gray-300">
                    {c.counts.completed} / {c.counts.totalEnrollments} ({completionPct}%)
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all"
                    style={{ width: `${completionPct}%` }}
                  />
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-[11px] text-gray-500">
                <span>Roles: {c.applicableRoles.join(', ') || '—'}</span>
                <span>{formatDate(c.updatedAt)}</span>
              </div>
            </Link>
          );
        })}
      </div>

      {courses && courses.length === 0 && !isLoading && (
        <div className="rounded-xl border border-dashed border-gray-300 dark:border-gray-700 p-10 text-center text-sm text-gray-500">
          No courses yet. The seed script creates the v1 employee onboarding course.
        </div>
      )}
    </div>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-md border border-gray-200 dark:border-gray-800 px-2 py-1.5">
      <div className="flex items-center gap-1 text-gray-500">{icon}<span>{label}</span></div>
      <p className="mt-0.5 text-sm font-semibold text-gray-900 dark:text-gray-100">{value}</p>
    </div>
  );
}
