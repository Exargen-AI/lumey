import { TaskStatus, TaskPriority } from '@prisma/client';
import prisma from '../config/database';

interface TaskSeed {
  title: string;
  description?: string;
  status: TaskStatus;
  priority: TaskPriority;
  assigneeEmail?: string;
  labels: string[];
  isBlocked?: boolean;
  blockerNote?: string;
  clientVisible?: boolean;
  dueDate?: Date;
}

const TASKS_BY_PROJECT: Record<string, TaskSeed[]> = {
  'furix-ai': [
    { title: 'Design multi-modal LLM pipeline', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P1, assigneeEmail: 'karthik@exargen.in', labels: ['architecture', 'ai'], dueDate: new Date('2026-04-15') },
    { title: 'Set up vector database (Pinecone)', status: TaskStatus.DONE, priority: TaskPriority.P1, assigneeEmail: 'karthik@exargen.in', labels: ['infrastructure'] },
    { title: 'Build React Native shell app', status: TaskStatus.TODO, priority: TaskPriority.P2, assigneeEmail: 'karthik@exargen.in', labels: ['mobile', 'frontend'], dueDate: new Date('2026-05-01') },
    { title: 'Implement RAG retrieval layer', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P0, assigneeEmail: 'karthik@exargen.in', labels: ['ai', 'backend'], isBlocked: true, blockerNote: 'Waiting for API key approval from OpenAI', dueDate: new Date('2026-04-10') },
    { title: 'Write API documentation', status: TaskStatus.BACKLOG, priority: TaskPriority.P3, labels: ['docs'], clientVisible: true },
    { title: 'User testing round 1', status: TaskStatus.TODO, priority: TaskPriority.P2, labels: ['testing'], dueDate: new Date('2026-05-15') },
  ],
  'clawmates-adk': [
    { title: 'Define agent lifecycle API', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P1, assigneeEmail: 'suresh@exargen.in', labels: ['api', 'architecture'] },
    { title: 'Build tool registration system', status: TaskStatus.TODO, priority: TaskPriority.P1, assigneeEmail: 'suresh@exargen.in', labels: ['core'], dueDate: new Date('2026-05-01') },
    { title: 'Implement memory persistence layer', status: TaskStatus.BACKLOG, priority: TaskPriority.P2, labels: ['storage'] },
    { title: 'Create sample agents (weather, search)', status: TaskStatus.BACKLOG, priority: TaskPriority.P3, labels: ['examples'] },
    { title: 'Design orchestration primitives', status: TaskStatus.IN_REVIEW, priority: TaskPriority.P0, assigneeEmail: 'suresh@exargen.in', labels: ['architecture'] },
  ],
  'rozcar': [
    { title: 'Implement driver verification flow', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P0, assigneeEmail: 'priya@exargen.in', labels: ['kyc', 'backend'], clientVisible: true, dueDate: new Date('2026-04-20') },
    { title: 'Build booking calendar UI', status: TaskStatus.DONE, priority: TaskPriority.P1, assigneeEmail: 'priya@exargen.in', labels: ['frontend'], clientVisible: true },
    { title: 'Integrate Razorpay payments', status: TaskStatus.TODO, priority: TaskPriority.P1, assigneeEmail: 'priya@exargen.in', labels: ['payments'], isBlocked: true, blockerNote: 'Waiting for merchant account approval', dueDate: new Date('2026-04-25') },
    { title: 'Set up push notifications', status: TaskStatus.BACKLOG, priority: TaskPriority.P2, labels: ['mobile'] },
    { title: 'Insurance partner API integration', status: TaskStatus.TODO, priority: TaskPriority.P1, labels: ['integration', 'insurance'], clientVisible: true, dueDate: new Date('2026-05-10') },
    { title: 'Load testing for booking flow', status: TaskStatus.BACKLOG, priority: TaskPriority.P3, labels: ['testing'] },
  ],
  'manacalendar': [
    { title: 'Fix timezone handling in recurring events', status: TaskStatus.IN_REVIEW, priority: TaskPriority.P1, assigneeEmail: 'karthik@exargen.in', labels: ['bug', 'backend'] },
    { title: 'Google Calendar sync improvements', status: TaskStatus.DONE, priority: TaskPriority.P1, assigneeEmail: 'karthik@exargen.in', labels: ['integration'] },
    { title: 'AI scheduling suggestion engine', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P2, assigneeEmail: 'karthik@exargen.in', labels: ['ai', 'feature'] },
    { title: 'Beta testing with 50 users', status: TaskStatus.TODO, priority: TaskPriority.P1, labels: ['testing'], dueDate: new Date('2026-04-20') },
    { title: 'App Store submission', status: TaskStatus.TODO, priority: TaskPriority.P0, labels: ['release'], dueDate: new Date('2026-04-30') },
  ],
  'dhandhaphone': [
    { title: 'Research chipset options (MediaTek vs Unisoc)', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P1, assigneeEmail: 'karthik@exargen.in', labels: ['hardware', 'research'] },
    { title: 'Custom Android ROM specification', status: TaskStatus.BACKLOG, priority: TaskPriority.P2, labels: ['os', 'spec'] },
    { title: 'Partner with manufacturing unit', status: TaskStatus.TODO, priority: TaskPriority.P0, assigneeEmail: 'suresh@exargen.in', labels: ['partnerships'], dueDate: new Date('2026-06-01') },
    { title: 'Design offline-first app framework', status: TaskStatus.BACKLOG, priority: TaskPriority.P2, labels: ['framework'] },
    { title: 'Cost analysis for BOM under $50', status: TaskStatus.TODO, priority: TaskPriority.P1, labels: ['hardware', 'finance'] },
  ],
  'neerati': [
    { title: 'Weaver onboarding flow', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P1, assigneeEmail: 'priya@exargen.in', labels: ['frontend', 'ux'] },
    { title: 'Product catalog with image upload', status: TaskStatus.DONE, priority: TaskPriority.P1, assigneeEmail: 'priya@exargen.in', labels: ['feature'] },
    { title: 'Payment gateway integration (UPI)', status: TaskStatus.TODO, priority: TaskPriority.P1, labels: ['payments'], dueDate: new Date('2026-05-01') },
    { title: 'Logistics partner API', status: TaskStatus.BACKLOG, priority: TaskPriority.P2, labels: ['integration'] },
    { title: 'Multi-language support (Telugu, Hindi)', status: TaskStatus.BACKLOG, priority: TaskPriority.P3, labels: ['i18n'] },
  ],
  'hpcl-analytics': [
    { title: 'Real-time inventory dashboard', status: TaskStatus.DONE, priority: TaskPriority.P0, assigneeEmail: 'priya@exargen.in', labels: ['dashboard'], clientVisible: true },
    { title: 'Predictive maintenance alerts', status: TaskStatus.DONE, priority: TaskPriority.P1, assigneeEmail: 'priya@exargen.in', labels: ['ml', 'alerts'], clientVisible: true },
    { title: 'Monthly report generation', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P2, assigneeEmail: 'priya@exargen.in', labels: ['reports'], clientVisible: true },
    { title: 'Mobile app for station managers', status: TaskStatus.TODO, priority: TaskPriority.P2, labels: ['mobile'], clientVisible: true, dueDate: new Date('2026-05-15') },
    { title: 'Data pipeline optimization', status: TaskStatus.IN_REVIEW, priority: TaskPriority.P1, assigneeEmail: 'priya@exargen.in', labels: ['infrastructure'] },
  ],
  'bountipos': [
    { title: 'Offline transaction queue', status: TaskStatus.IN_PROGRESS, priority: TaskPriority.P0, assigneeEmail: 'suresh@exargen.in', labels: ['offline', 'core'], isBlocked: true, blockerNote: 'IndexedDB corruption issue on older Android devices' },
    { title: 'UPI QR code payment', status: TaskStatus.TODO, priority: TaskPriority.P0, assigneeEmail: 'suresh@exargen.in', labels: ['payments'], dueDate: new Date('2026-04-10') },
    { title: 'GST invoice generation', status: TaskStatus.TODO, priority: TaskPriority.P1, assigneeEmail: 'suresh@exargen.in', labels: ['compliance'], dueDate: new Date('2026-04-20') },
    { title: 'Inventory barcode scanner', status: TaskStatus.BACKLOG, priority: TaskPriority.P2, labels: ['feature'] },
    { title: 'Multi-store management', status: TaskStatus.BACKLOG, priority: TaskPriority.P3, labels: ['feature'] },
    { title: 'Sales analytics dashboard', status: TaskStatus.TODO, priority: TaskPriority.P2, labels: ['analytics'], dueDate: new Date('2026-05-01') },
  ],
};

export async function seedTasks(userMap: Map<string, string>, projectMap: Map<string, string>) {
  console.log('Seeding tasks...');
  let count = 0;

  // Get the super admin as default creator
  const creatorId = userMap.get('admin@exargen.in')!;

  for (const [slug, tasks] of Object.entries(TASKS_BY_PROJECT)) {
    const projectId = projectMap.get(slug);
    if (!projectId) continue;

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const assigneeId = task.assigneeEmail ? userMap.get(task.assigneeEmail) : undefined;

      await prisma.task.create({
        data: {
          projectId,
          // Per-project unique counter (1, 2, 3, …). Required after the
          // 20260503_capture_schema_drift migration adds the
          // (projectId, taskNumber) unique index — without this every task
          // would collide on the default value of 0.
          taskNumber: i + 1,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          assigneeId: assigneeId || null,
          creatorId,
          dueDate: task.dueDate || null,
          labels: task.labels,
          isBlocked: task.isBlocked || false,
          blockerNote: task.blockerNote || null,
          clientVisible: task.clientVisible || false,
          sortOrder: i + 1,
          isSeedData: true,
        },
      });
      count++;
    }

    // Bump the project's taskCounter so any tasks created after seeding (e.g.
    // via the UI) get the next number in sequence rather than colliding.
    if (tasks.length > 0) {
      await prisma.project.update({
        where: { id: projectId },
        data: { taskCounter: tasks.length },
      });
    }
  }

  console.log(`Seeded ${count} tasks across ${Object.keys(TASKS_BY_PROJECT).length} projects`);
}
