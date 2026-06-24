import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Settings, Trash2, Download, AlertTriangle, Database, Users, FolderKanban, CheckSquare } from 'lucide-react';
import { clearSeedData, getSystemStats, exportData } from '@/api/admin';
import { cn } from '@/lib/cn';

export function SystemSettingsPage() {
  const isProduction = import.meta.env.PROD;
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [confirmText, setConfirmText] = useState('');

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['system-stats'],
    queryFn: getSystemStats,
  });

  const clearMutation = useMutation({
    mutationFn: clearSeedData,
    onSuccess: () => {
      setShowClearConfirm(false);
      setConfirmText('');
      refetchStats();
    },
  });

  const exportMutation = useMutation({
    mutationFn: exportData,
    onSuccess: (data) => {
      // Download the exported data as JSON
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `exargen-export-${new Date().toLocaleDateString('en-CA')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Settings size={24} className="text-brand-600" />
        <h1 className="text-2xl font-bold text-gray-900">System Settings</h1>
      </div>

      {/* System Stats */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">System Statistics</h2>
        {statsLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
                <div className="h-8 bg-gray-200 rounded w-1/3" />
              </div>
            ))}
          </div>
        ) : stats ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatBox icon={<Users size={18} className="text-blue-600" />} label="Users" value={stats.users ?? stats.totalUsers ?? 0} />
            <StatBox icon={<FolderKanban size={18} className="text-purple-600" />} label="Projects" value={stats.projects ?? stats.totalProjects ?? 0} />
            <StatBox icon={<CheckSquare size={18} className="text-green-600" />} label="Tasks" value={stats.tasks ?? stats.totalTasks ?? 0} />
            <StatBox icon={<Database size={18} className="text-orange-600" />} label="Milestones" value={stats.milestones ?? stats.totalMilestones ?? 0} />
          </div>
        ) : (
          <p className="text-sm text-gray-500">Unable to load system stats.</p>
        )}
      </div>

      {/* Export Data */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-2">Export Data</h2>
        <p className="text-sm text-gray-500 mb-4">Download all system data as a JSON file for backup or migration.</p>
        <button
          onClick={() => exportMutation.mutate()}
          disabled={exportMutation.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 transition-colors',
            exportMutation.isPending && 'opacity-50 cursor-not-allowed',
          )}
        >
          <Download size={16} />
          {exportMutation.isPending ? 'Exporting...' : 'Export Data'}
        </button>
        {exportMutation.isError && (
          <p className="mt-2 text-sm text-red-600">Export failed. Please try again.</p>
        )}
      </div>

      {/* Danger Zone */}
      <div className="bg-white rounded-xl border border-red-200 p-6">
        <div className="flex items-center gap-2 mb-2">
          <AlertTriangle size={18} className="text-red-600" />
          <h2 className="text-lg font-semibold text-red-900">Danger Zone</h2>
        </div>
        {isProduction ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <p className="text-sm text-amber-800">
              Seed-data clearing is intentionally disabled in production builds.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 mb-4">
              Clear all seed data from the system. This action removes all demo/seed data but preserves manually created records.
              This cannot be undone.
            </p>

            {!showClearConfirm ? (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700 transition-colors"
              >
                <Trash2 size={16} /> Clear Seed Data
              </button>
            ) : (
              <div className="border border-red-200 bg-red-50 rounded-lg p-4 space-y-3">
                <p className="text-sm font-medium text-red-800">
                  Type "DELETE" to confirm clearing seed data:
                </p>
                <input
                  type="text"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder='Type "DELETE"'
                  className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => {
                      if (confirmText === 'DELETE') clearMutation.mutate();
                    }}
                    disabled={confirmText !== 'DELETE' || clearMutation.isPending}
                    className={cn(
                      'px-4 py-2 bg-red-600 text-white text-sm rounded-lg transition-colors',
                      confirmText === 'DELETE' && !clearMutation.isPending ? 'hover:bg-red-700' : 'opacity-50 cursor-not-allowed',
                    )}
                  >
                    {clearMutation.isPending ? 'Clearing...' : 'Confirm Clear'}
                  </button>
                  <button
                    onClick={() => {
                      setShowClearConfirm(false);
                      setConfirmText('');
                    }}
                    className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900"
                  >
                    Cancel
                  </button>
                </div>
                {clearMutation.isSuccess && (
                  <p className="text-sm text-green-700">Seed data cleared successfully.</p>
                )}
                {clearMutation.isError && (
                  <p className="text-sm text-red-700">Failed to clear seed data. Please try again.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="text-center p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center justify-center mb-2">{icon}</div>
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}
