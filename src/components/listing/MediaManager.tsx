import React, { useRef, useState } from 'react';
import {
  uploadListingMedia,
  deleteListingMedia,
  setCoverMedia,
  reorderListingMedia,
  cloudinaryUrl,
  UploadProgress,
} from '../../lib/cloudinary';
import { ListingMedia } from '../../types';
import { SafeImage } from './SafeImage';

// The photo step of the listing editor. Uploads go browser -> Cloudinary
// directly (see lib/cloudinary.ts); this component owns only the ordering,
// the cover choice and the delete confirmation.

// Cloudinary's free tier caps a single upload at 10MB, and a modern phone
// camera clears that easily. Catching it here — before the file is queued —
// means the agent finds out immediately instead of after four minutes of
// uploading on hotel wifi.
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  listingId: string;
  media: ListingMedia[];
  onChange: (media: ListingMedia[]) => void;
  disabled?: boolean;
}

export const MediaManager: React.FC<Props> = ({ listingId, media, onChange, disabled }) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ListingMedia | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setError(null);

    const files = Array.from(fileList);
    const tooBig = files.filter((f) => f.size > MAX_BYTES);
    const usable = files.filter((f) => f.size <= MAX_BYTES);

    if (tooBig.length > 0) {
      setError(
        `${tooBig.length} file${tooBig.length > 1 ? 's are' : ' is'} over 10MB and ${
          tooBig.length > 1 ? 'were' : 'was'
        } skipped: ${tooBig.map((f) => f.name).join(', ')}`
      );
    }
    if (usable.length === 0) return;

    setProgress({ completed: 0, total: usable.length, failed: 0 });
    try {
      const hadNoCover = media.length === 0;

      // Everything uploads as gallery, and the cover is promoted afterwards.
      // `role` applies to the whole batch, so the previous version — passing
      // 'cover' when the listing was empty — marked EVERY photo in the first
      // upload as the cover. Three photos in, three covers, and which one the
      // grid showed depended on which row came back first.
      const uploaded = await uploadListingMedia({
        listingId,
        files: usable,
        kind: 'image',
        role: 'gallery',
        onProgress: setProgress,
      });

      let next = [...media, ...uploaded];
      if (hadNoCover && uploaded.length > 0) {
        await setCoverMedia(listingId, uploaded[0].id);
        next = next.map((m) => (m.id === uploaded[0].id ? { ...m, role: 'cover' as const } : m));
      }
      onChange(next);
    } catch (err: any) {
      // uploadListingMedia attaches whatever *did* land to a partial-failure
      // error, so a half-successful batch still shows its photos instead of
      // silently discarding them.
      if (Array.isArray(err?.partial) && err.partial.length > 0) {
        onChange([...media, ...err.partial]);
      }
      setError(err?.message || 'Upload failed');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const target = pendingDelete;
    setPendingDelete(null);
    try {
      await deleteListingMedia(listingId, target);
      const remaining = media.filter((m) => m.id !== target.id);
      // Deleting the cover must promote a replacement, or the listing silently
      // loses its card image.
      if (target.role === 'cover' && remaining.length > 0) {
        await setCoverMedia(listingId, remaining[0].id);
        remaining[0] = { ...remaining[0], role: 'cover' };
      }
      onChange(remaining);
    } catch (err: any) {
      setError(err?.message || 'Could not delete that photo');
    }
  };

  const makeCover = async (m: ListingMedia) => {
    try {
      await setCoverMedia(listingId, m.id);
      onChange(media.map((x) => ({ ...x, role: x.id === m.id ? 'cover' : x.role === 'cover' ? 'gallery' : x.role })));
    } catch (err: any) {
      setError(err?.message || 'Could not set the cover');
    }
  };

  const handleDrop = async (targetIndex: number) => {
    if (dragIndex === null || dragIndex === targetIndex) return;
    const next = [...media];
    const [moved] = next.splice(dragIndex, 1);
    next.splice(targetIndex, 0, moved);
    setDragIndex(null);
    onChange(next.map((m, i) => ({ ...m, position: i })));
    try {
      await reorderListingMedia(next);
    } catch (err: any) {
      setError(err?.message || 'Could not save the new order');
    }
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px] mt-px">error</span>
          <span>{error}</span>
        </div>
      )}

      {!disabled && (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFiles(e.dataTransfer.files);
          }}
          className="border-2 border-dashed border-slate-200 hover:border-emerald-400 rounded-2xl p-10 text-center cursor-pointer transition-colors group"
        >
          <span className="material-symbols-outlined text-4xl text-slate-300 group-hover:text-emerald-400 transition-colors">
            add_photo_alternate
          </span>
          <p className="text-sm font-semibold text-slate-600 mt-2">Drop photos here, or click to browse</p>
          <p className="text-xs text-slate-400 mt-1">JPG, PNG, WebP or HEIC · up to 10MB each · 30 at a time</p>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
            multiple
            hidden
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      )}

      {progress && (
        <div className="bg-slate-50 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-600">
            <span>Uploading… {progress.completed} of {progress.total}</span>
            {progress.failed > 0 && <span className="text-rose-500">{progress.failed} failed</span>}
          </div>
          <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all duration-300"
              style={{ width: `${(progress.completed / progress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      {media.length === 0 && !progress ? (
        <p className="text-sm text-slate-400 text-center py-4">
          No photos yet. A listing can't be submitted for review without at least one.
        </p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {media.map((m, i) => (
            <figure
              key={m.id}
              draggable={!disabled}
              onDragStart={() => setDragIndex(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              className={`relative rounded-xl overflow-hidden border group aspect-[4/3] bg-slate-100 ${
                m.role === 'cover' ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-200'
              } ${disabled ? '' : 'cursor-grab active:cursor-grabbing'} ${dragIndex === i ? 'opacity-40' : ''}`}
            >
              <SafeImage
                src={cloudinaryUrl(m.cloudinary_public_id, { width: 400, height: 300, version: m.cloudinary_version })}
                alt={m.alt || ''}
                label="File gone — delete this and re-upload"
                className="w-full h-full object-cover"
              />

              {m.role === 'cover' && (
                <span className="absolute top-2 left-2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded tracking-wide">
                  COVER
                </span>
              )}

              {!disabled && (
                <figcaption className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  {m.role !== 'cover' && (
                    <button
                      type="button"
                      onClick={() => makeCover(m)}
                      className="text-[10px] font-bold text-white bg-white/20 hover:bg-white/30 px-2 py-1 rounded backdrop-blur-sm"
                    >
                      Make cover
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setPendingDelete(m)}
                    className="text-[10px] font-bold text-white bg-rose-500/80 hover:bg-rose-500 px-2 py-1 rounded ml-auto"
                  >
                    Delete
                  </button>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
      )}

      {/* Deleting removes the file from Cloudinary too, so this is genuinely
          unrecoverable — worth one confirm rather than an undo that would
          have nothing left to restore. */}
      {pendingDelete && (
        <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-8 max-w-sm w-full space-y-4 shadow-xl">
            <h3 className="font-geist font-semibold text-slate-800">Delete this photo?</h3>
            <p className="text-sm text-slate-500">
              It will be removed from the listing and permanently deleted from Cloudinary. This can't be undone.
            </p>
            <div className="flex gap-3 justify-end pt-2">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="px-5 py-2.5 rounded-xl text-sm font-bold text-white bg-rose-500 hover:bg-rose-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
