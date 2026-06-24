import { DecisionStatus } from '@prisma/client';
import prisma from '../config/database';

const DECISIONS_BY_PROJECT: Record<string, { title: string; rationale: string; alternatives?: string; status: DecisionStatus; tags: string[] }[]> = {
  'furix-ai': [
    {
      title: 'Selected LangChain over LlamaIndex for orchestration',
      rationale: 'LangChain has better support for multi-modal pipelines and a more active community. The agent framework is more mature and supports our custom tool integration requirements.',
      alternatives: 'LlamaIndex: Better for pure RAG use cases but lacks agent orchestration depth. Custom solution: Too much maintenance overhead for our team size.',
      status: DecisionStatus.ACCEPTED, tags: ['architecture', 'ai'],
    },
    {
      title: 'Use Pinecone for vector storage instead of self-hosted Qdrant',
      rationale: 'Pinecone offers managed infrastructure, automatic scaling, and lower operational burden. Cost is acceptable for our data volume.',
      alternatives: 'Qdrant self-hosted: Better cost at scale but requires DevOps capacity we lack. Weaviate: Similar pricing but less mature TypeScript SDK.',
      status: DecisionStatus.ACCEPTED, tags: ['infrastructure', 'vendor'],
    },
  ],
  'clawmates-adk': [
    {
      title: 'TypeScript-first SDK with Python bindings later',
      rationale: 'Our team has stronger TypeScript expertise. The Node.js ecosystem has better async patterns for agent I/O. Python bindings can be auto-generated from TypeScript definitions.',
      status: DecisionStatus.ACCEPTED, tags: ['architecture', 'language'],
    },
  ],
  'rozcar': [
    {
      title: 'React Native over Flutter for mobile app',
      rationale: 'Team has existing React expertise. Code sharing with web dashboard is easier. Flutter would require learning Dart and maintaining separate design patterns.',
      alternatives: 'Flutter: Better performance for animations but steeper learning curve. Native: Not feasible with current team size for both platforms.',
      status: DecisionStatus.ACCEPTED, tags: ['architecture', 'mobile'],
    },
  ],
  'bountipos': [
    {
      title: 'IndexedDB for offline storage instead of SQLite',
      rationale: 'IndexedDB is natively available in WebView-based apps without plugins. Reduces app size and build complexity. Performance is adequate for POS transaction volumes.',
      alternatives: 'SQLite via Capacitor: Better query performance but adds native dependency. PouchDB+CouchDB: Good sync but complex setup for our offline-first requirements.',
      status: DecisionStatus.ACCEPTED, tags: ['architecture', 'storage'],
    },
  ],
  'hpcl-analytics': [
    {
      title: 'Apache Kafka for real-time data ingestion',
      rationale: 'Kafka handles the high-throughput data streams from 15,000+ fuel stations. Built-in partitioning ensures data locality for regional processing.',
      status: DecisionStatus.ACCEPTED, tags: ['infrastructure', 'data'],
    },
  ],
};

export async function seedDecisions(userMap: Map<string, string>, projectMap: Map<string, string>) {
  console.log('Seeding decisions...');
  let count = 0;
  const creatorId = userMap.get('admin@exargen.in')!;

  for (const [slug, decisions] of Object.entries(DECISIONS_BY_PROJECT)) {
    const projectId = projectMap.get(slug);
    if (!projectId) continue;

    for (const dec of decisions) {
      await prisma.decision.create({
        data: { ...dec, projectId, createdById: creatorId, isSeedData: true },
      });
      count++;
    }
  }

  console.log(`Seeded ${count} decisions`);
}
