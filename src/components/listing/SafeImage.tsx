import React, { useState } from 'react';

// An <img> that says what went wrong instead of rendering a broken icon.
//
// A listing photo can outlive its file: the row and the Cloudinary asset are
// two separate deletes, and any failure between them leaves a row pointing at
// nothing. The server-side path that caused that is fixed, but a broken
// thumbnail is invisible-by-default — an admin scanning a queue reads it as
// "slow to load" and approves the listing anyway, and the same gap appears on
// the public site later. Naming it turns a silent defect into a visible one.

interface Props {
  src: string;
  alt?: string;
  className?: string;
  label?: string;
}

export const SafeImage: React.FC<Props> = ({ src, alt = '', className = '', label = 'Photo missing' }) => {
  const [failed, setFailed] = useState(false);

  if (failed || !src) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-1 bg-rose-50 text-rose-400 ${className}`}
        title="This photo's file no longer exists in Cloudinary. Delete it from the listing and re-upload."
      >
        <span className="material-symbols-outlined text-2xl">broken_image</span>
        <span className="text-[10px] font-semibold text-center px-2 leading-tight">{label}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={className}
    />
  );
};
