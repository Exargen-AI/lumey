import api from './client';
import type { CourseView } from '@exargen/shared';

export async function getCourseBySlug(slug: string): Promise<CourseView> {
  const { data } = await api.get(`/courses/${slug}`);
  return data.data;
}
