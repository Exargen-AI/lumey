import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Modal, Button, Field, Input, Textarea } from '@/components/ui';
import { cn } from '@/lib/cn';

interface CreateProjectDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (data: { name: string; description?: string; domain?: string }) => Promise<void>;
  isLoading?: boolean;
  error?: string;
}

export function CreateProjectDialog({ isOpen, onClose, onCreate, isLoading, error }: CreateProjectDialogProps) {
  const [formData, setFormData] = useState({ name: '', description: '', domain: '' });
  const [nameError, setNameError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setNameError('Project name is required');
      return;
    }
    setNameError('');
    await onCreate({
      name: formData.name.trim(),
      description: formData.description.trim() || undefined,
      domain: formData.domain.trim() || undefined,
    });
  };

  const handleClose = () => {
    if (isLoading) return;
    setFormData({ name: '', description: '', domain: '' });
    setNameError('');
    onClose();
  };

  return (
    <Modal
      open={isOpen}
      onClose={handleClose}
      title="Create New Project"
      size="md"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            loading={isLoading}
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
          >
            {isLoading ? 'Creating…' : 'Create Project'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className={cn(
            'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm animate-fade-in',
            'bg-rose-50 border border-rose-200 text-rose-700',
            'dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300',
          )}>
            <AlertCircle size={15} className="mt-0.5 shrink-0" />
            <span className="leading-snug">{error}</span>
          </div>
        )}

        <Field label="Project Name" required error={nameError || undefined}>
          <Input
            type="text"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Enter project name"
            disabled={isLoading}
            autoFocus
            invalid={!!nameError}
          />
        </Field>

        <Field label="Description">
          <Textarea
            value={formData.description}
            onChange={(e) => setFormData({ ...formData, description: e.target.value })}
            rows={3}
            placeholder="Brief description of your project"
            disabled={isLoading}
          />
        </Field>

        <Field label="Domain" hint="Used for API access and public endpoints">
          <Input
            type="text"
            value={formData.domain}
            onChange={(e) => setFormData({ ...formData, domain: e.target.value })}
            placeholder="example.com"
            disabled={isLoading}
          />
        </Field>

        {/* Hidden submit button so Enter key submits the form */}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
