import api from './client';

export interface ComplianceDocument {
  courseSlug: string;
  courseTitle: string;
  documentSlug: string;
  documentTitle: string;
  documentVersion: number | null;
  signedAt: string | null;
  signedName: string | null;
}

export interface ComplianceMember {
  userId: string;
  name: string;
  role: 'SUPER_ADMIN' | 'ADMIN' | 'PRODUCT_MANAGER' | 'ENGINEER';
  company: string | null;
  allSigned: boolean;
  documents: ComplianceDocument[];
}

export interface ProjectComplianceSummary {
  projectId: string;
  generatedAt: string;
  members: ComplianceMember[];
  totalAgreements: number;
  signedAgreements: number;
}

export async function getProjectCompliance(projectId: string): Promise<ProjectComplianceSummary> {
  const { data } = await api.get(`/projects/${projectId}/compliance`);
  return data.data;
}
