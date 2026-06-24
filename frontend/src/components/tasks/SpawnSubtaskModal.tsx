import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, GitFork, Loader2 } from 'lucide-react';
import { Modal, Field, Input, Textarea, Select, Button } from '@/components/ui';
import { useSpawnSubtask } from '@/hooks/useTaskLinks';
import { cn } from '@/lib/cn';

type TaskType = 'FEATURE' | 'BUG' | 'CHORE' | 'SPIKE';

interface SpawnSubtaskModalProps {
  open: boolean;
  onClose: () => void;
  parentTask: { id: string; title: string; projectId: string };
}

/**
 * Spin off a child task from a bug (or any task — the button just
 * surfaces on bugs by default since that's the primary use case).
 * Child task inherits productId + clientVisible from the parent
 * server-side, so the user only needs to give a title + optional
 * description + optional type.
 */
export function SpawnSubtaskModal({ open, onClose, parentTask }: SpawnSubtaskModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [taskType, setTaskType] = useState<TaskType>('FEATURE');
  const [error, setError] = useState<string | null>(null);

  const spawn = useSpawnSubtask(parentTask.id, parentTask.projectId);

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setDescription('');
    setTaskType('FEATURE');
    setError(null);
  }, [open]);

  const valid = useMemo(() => title.trim().length > 0 && title.trim().length <= 200, [title]);
  const pending = spawn.isPending;

  const submit = async () => {
    if (!valid) return;
    setError(null);
    try {
      await spawn.mutateAsync({
        title: title.trim(),
        description: description.trim() || null,
        taskType,
      });
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not spin off the task. Try again?');
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!pending) onClose(); }}
      title="Spin off a task"
      subtitle={`Creates a new task linked to "${parentTask.title}" via Spawned-from. Inherits the parent's product + visibility.`}
      size="md"
      accent="brand"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!valid || pending}>
            {pending && <Loader2 size={13} className="animate-spin mr-1.5" />}
            <GitFork size={13} /> Spawn task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Title">
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What does the new task do?"
            maxLength={200}
          />
        </Field>

        <Field label="Type" hint="Most bug spin-offs are fixes (Feature) or follow-up Chores.">
          <Select value={taskType} onChange={(e) => setTaskType(e.target.value as TaskType)}>
            <option value="FEATURE">Feature</option>
            <option value="CHORE">Chore</option>
            <option value="BUG">Bug</option>
            <option value="SPIKE">Spike</option>
          </Select>
        </Field>

        <Field label="Description" hint="Optional — paste plan, repro context, anything the assignee will want at hand.">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            maxLength={10_000}
            placeholder="e.g. Fix the missing mobile media query on /login. Match the desktop spacing system."
          />
        </Field>

        {error && (
          <div className={cn(
            'flex items-start gap-2 text-[12px] rounded-md p-2.5',
            'bg-rose-50 text-rose-700 border border-rose-200',
            'dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
          )}>
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </Modal>
  );
}
