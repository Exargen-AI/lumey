/**
 * Internal "Today" page — `/today`.
 *
 * Layout:
 *   ┌────────────────────────────────────────────┐
 *   │  GreetingHeader (good morning, name 🌅)    │
 *   ├────────────────────────────────────────────┤
 *   │  TodayVibeCard  (productive today + quote)  │
 *   ├────────────────────────────────────────────┤
 *   │  Clock-in/out card  |  Standup card        │
 *   ├────────────────────────────────────────────┤
 *   │             ActivityFeedView                │
 *   └────────────────────────────────────────────┘
 *
 * Vibe + greeting added 2026-05-29. Clock + standup are 2026-05-28b.
 * ActivityFeedView is the original page content.
 */

import { ActivityFeedView } from '@/components/activity/ActivityFeedView';
import { ClockCard } from '@/components/today/ClockCard';
import { GreetingHeader } from '@/components/today/GreetingHeader';
import { StandupCard } from '@/components/today/StandupCard';
import { TodayVibeCard } from '@/components/today/TodayVibeCard';

export function TodayPage() {
  return (
    <div className="space-y-6 p-6 max-w-6xl mx-auto">
      <GreetingHeader />
      <TodayVibeCard />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ClockCard />
        <StandupCard />
      </div>
      <ActivityFeedView />
    </div>
  );
}
