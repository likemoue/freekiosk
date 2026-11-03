import { Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { uploadFile } from '../api';
import { bytes } from '../format';
import { Button, errorText, Progress } from '../ui';

/** Picks files and sends them in parts; `finish` turns a finished upload into a record */
export function UploadButton({ purpose, accept, multiple, label, onDone, finish, onError }: {
  purpose: 'media' | 'apk';
  accept: string;
  multiple?: boolean;
  label: string;
  finish: (uploadId: string, file: File) => Promise<unknown>;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ name: string; size: number; fraction: number } | null>(null);

  const run = async (files: FileList) => {
    for (const file of Array.from(files)) {
      try {
        setProgress({ name: file.name, size: file.size, fraction: 0 });
        const id = await uploadFile(file, purpose, (fraction) => setProgress({ name: file.name, size: file.size, fraction }));
        await finish(id, file);
      } catch (error) {
        onError(`${file.name}: ${errorText(error)}`);
      }
    }
    setProgress(null);
    onDone();
    if (input.current) input.current.value = '';
  };

  return (
    <>
      <input ref={input} type="file" hidden accept={accept} multiple={multiple} onChange={(e) => e.target.files?.length && run(e.target.files)} />
      <Button variant="outline" disabled={!!progress} onClick={() => input.current?.click()}>
        <Upload className="size-4" /> {label}
      </Button>
      {progress && (
        <div className="fixed right-4 bottom-4 z-50 w-80 rounded-2xl border border-line bg-card p-4 shadow-2xl" role="status">
          <p className="truncate text-sm font-semibold">{progress.name}</p>
          <p className="mb-2 text-xs text-soft">{Math.round(progress.fraction * 100)}% của {bytes(progress.size)}. Đừng đóng trang này.</p>
          <Progress value={progress.fraction * 100} />
        </div>
      )}
    </>
  );
}
