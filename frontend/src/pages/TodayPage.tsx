/**
 * Internal "Today" page — `/today`.
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │  GreetingHeader (good morning, name 🌅)    │
 *   ├────────────────────────────────────────────┤
 *   │  TodayVibeCard  (productive today + quote)  │
 *   ├────────────────────────────────────────────┤
 *   │                Standup card                 │
 *   ├────────────────────────────────────────────┤
 *   │             ActivityFeedView                │
 *   └────────────────────────────────────────────┘
 *
 * Vibe + greeting added 2026-05-29. Standup is 2026-05-28b.
 * ActivityFeedView is the original page content.
 */

import { ActivityFeedView } from '@/components/activity/ActivityFeedView';
import { GreetingHeader } from '@/components/today/GreetingHeader';
import { StandupCard } from '@/components/today/StandupCard';
import { TodayVibeCard } from '@/components/today/TodayVibeCard';

export function TodayPage() {
  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <GreetingHeader />
      <TodayVibeCard />
      <StandupCard />
      <ActivityFeedView />
    </div>
  );
}
