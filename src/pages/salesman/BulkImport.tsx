import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Page, Main, TopHeader } from '../../components/Shell';
import { useStaff } from '../../context/StaffContext';
import {
  parseImportFile, flagExistingDuplicates, runImport, buildTemplateCsv,
  ParsedListing, ParseResult, ImportOutcome, ImportProgress, MAX_ROWS,
} from '../../lib/bulkImport';
import { submitVendorListing } from '../../lib/api';
import { LISTING_CATEGORY_LABELS } from '../../types';

// Bulk import: spreadsheet in, draft listings out.
//
// Three phases, and the middle one is the point of the whole screen. Parsing
// tells the agent exactly what will be created, per row, with every problem
// named, BEFORE anything is written. An importer that just runs and reports
// afterwards leaves someone with fifty half-right listings and no way to tell
// which ones need attention.

type Phase = 'pick' | 'preview' | 'running' | 'done';

export const BulkImport: React.FC = () => {
  const { staff } = useStaff();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>('pick');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<ParseResult | null>(null);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [outcomes, setOutcomes] = useState<ImportOutcome[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitNote, setSubmitNote] = useState<string | null>(null);

  const importable = useMemo(
    () => (result?.listings ?? []).filter((l) => l.errors.length === 0 && !skipped.has(l.rowNumber)),
    [result, skipped]
  );

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setFileName(file.name);
    try {
      const parsed = await parseImportFile(file);
      if (staff && parsed.listings.length > 0) {
        // Checked against what this agent already owns, not globally: two
        // agents legitimately working different regions can both have a
        // "Taj Palace", and warning on that would be noise.
        await flagExistingDuplicates(staff.id, parsed.listings);
      }
      setResult(parsed);
      setSkipped(new Set());
      setPhase('preview');
    } catch (err: any) {
      setError(err?.message || 'Could not read that file');
    }
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplateCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mydreamevents-listings-template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const start = async () => {
    setPhase('running');
    setError(null);
    try {
      const res = await runImport(importable, setProgress);
      setOutcomes(res);
      setPhase('done');
    } catch (err: any) {
      setError(err?.message || 'The import stopped unexpectedly');
      setPhase('preview');
    }
  };

  const submitAll = async () => {
    setSubmitting(true);
    setSubmitNote(null);
    const ids = outcomes.filter((o) => o.listingId && !o.error).map((o) => o.listingId!);
    let ok = 0;
    const failures: string[] = [];
    for (const id of ids) {
      try {
        await submitVendorListing(id);
        ok++;
      } catch (err: any) {
        // Almost always the completeness check refusing a listing with no
        // city or no photo — which is the check doing its job, not a bug.
        failures.push(err?.message || 'rejected');
      }
    }
    setSubmitNote(
      failures.length === 0
        ? `All ${ok} sent for approval.`
        : `${ok} sent for approval. ${failures.length} still need work — open them and check the Review step.`
    );
    setSubmitting(false);
  };

  return (
    <Page>
      <TopHeader
        title="Bulk Import"
        subtitle="A spreadsheet of vendors — and their photos — in one go"
        right={
          <button
            type="button"
            onClick={downloadTemplate}
            className="px-5 py-2.5 rounded-xl text-sm font-bold border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            CSV template
          </button>
        }
      />
      <Main>
        <div className="space-y-6">
          {error && (
            <div className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] mt-px">error</span>
              <span>{error}</span>
            </div>
          )}

          {phase === 'pick' && (
            <>
              <div
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
                className="bg-white border-2 border-dashed border-slate-200 hover:border-emerald-400 rounded-2xl p-14 text-center cursor-pointer transition-colors group"
              >
                <span className="material-symbols-outlined text-5xl text-slate-300 group-hover:text-emerald-400 transition-colors">
                  upload_file
                </span>
                <p className="text-base font-semibold text-slate-700 mt-3">Drop a .csv or .zip here</p>
                <p className="text-sm text-slate-400 mt-1">
                  Up to {MAX_ROWS} listings at a time. Nothing is created until you've reviewed it.
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv,.zip,text/csv,application/zip"
                  hidden
                  onChange={(e) => handleFile(e.target.files?.[0])}
                />
              </div>

              <div className="bg-white rounded-2xl border border-slate-100 p-8 space-y-5">
                <h2 className="font-geist font-semibold text-slate-800">How to prepare the file</h2>

                <Step n={1} title="Start from the template">
                  Download it above. It has every column, and one filled-in example row showing the format.
                  Delete that row before importing. Extra columns are ignored, missing ones are just left blank.
                </Step>

                <Step n={2} title="Multi-value cells">
                  Separate items with <Code>;</Code> and an item's own fields with <Code>|</Code>:
                  <div className="mt-2 space-y-1">
                    <Example label="amenities">Spa; Fitness centre; Conference room</Example>
                    <Example label="halls">Lawrence Hall|banquet|2799|112; Auckland Room|indoor|444|18</Example>
                    <Example label="rooms">Deluxe Garden View|463|20; Kitchener Suite|1475|1</Example>
                  </div>
                </Step>

                <Step n={3} title="Photos (optional)">
                  Zip the CSV together with an <Code>images/</Code> folder, one subfolder per listing named to
                  match that row's <Code>ref</Code> column:
                  <pre className="mt-2 bg-slate-50 rounded-lg p-3 text-[11px] text-slate-600 leading-relaxed overflow-x-auto">{`upload.zip
├── listings.csv
└── images/
    ├── wildflower-hall/       ← matches ref "wildflower-hall"
    │   ├── 01-exterior.jpg    ← first by filename becomes the cover
    │   └── 02-lawn.jpg
    └── taj-theog/
        └── front.jpg`}</pre>
                  Files sort by name, so number them if you care which one is the cover.
                </Step>

                <Step n={4} title="Everything arrives as a draft">
                  Nothing goes near the public site. Review and adjust each one in the normal editor,
                  then send for approval — an admin still sees every listing before it goes live.
                </Step>
              </div>
            </>
          )}

          {phase === 'preview' && result && (
            <PreviewTable
              result={result}
              fileName={fileName}
              skipped={skipped}
              onToggleSkip={(row) => {
                const next = new Set(skipped);
                next.has(row) ? next.delete(row) : next.add(row);
                setSkipped(next);
              }}
              importableCount={importable.length}
              onBack={() => { setPhase('pick'); setResult(null); }}
              onStart={start}
            />
          )}

          {phase === 'running' && progress && (
            <div className="bg-white rounded-2xl border border-slate-100 p-10 space-y-4">
              <h2 className="font-geist font-semibold text-slate-800">
                Importing… {progress.done} of {progress.total}
              </h2>
              {progress.current && <p className="text-sm text-slate-500">{progress.current}</p>}
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">
                One listing at a time, so photo uploads don't trip the rate limit. Don't close this tab.
              </p>
            </div>
          )}

          {phase === 'done' && (
            <ResultsPanel
              outcomes={outcomes}
              submitting={submitting}
              submitNote={submitNote}
              onSubmitAll={submitAll}
              onOpen={(id) => navigate(`/salesman/listing/${id}`)}
              onAgain={() => { setPhase('pick'); setResult(null); setOutcomes([]); setSubmitNote(null); }}
              onList={() => navigate('/salesman/listings')}
            />
          )}
        </div>
      </Main>
    </Page>
  );
};

const PreviewTable: React.FC<{
  result: ParseResult;
  fileName: string;
  skipped: Set<number>;
  onToggleSkip: (row: number) => void;
  importableCount: number;
  onBack: () => void;
  onStart: () => void;
}> = ({ result, fileName, skipped, onToggleSkip, importableCount, onBack, onStart }) => {
  const withErrors = result.listings.filter((l) => l.errors.length > 0).length;
  const withWarnings = result.listings.filter((l) => l.errors.length === 0 && l.warnings.length > 0).length;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-100 p-6 flex flex-wrap items-center gap-6">
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <span className="material-symbols-outlined text-[18px] text-slate-300">description</span>
          {fileName}
        </div>
        <Pill tone="ok" label={`${importableCount} will import`} />
        {withWarnings > 0 && <Pill tone="warn" label={`${withWarnings} with warnings`} />}
        {withErrors > 0 && <Pill tone="bad" label={`${withErrors} blocked`} />}
        {result.imagesFound > 0 && <Pill tone="ok" label={`${result.imagesFound} photos found`} />}
      </div>

      {result.fileErrors.map((e) => (
        <div key={e} className="bg-rose-50 border border-rose-100 text-rose-700 text-sm px-4 py-3 rounded-xl">{e}</div>
      ))}

      {result.unmatchedImageFolders.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-sm px-4 py-3 rounded-xl">
          <strong className="font-semibold">Photo folders that match no row:</strong>{' '}
          {result.unmatchedImageFolders.join(', ')} — check these against the <code>ref</code> column, or those
          photos will simply be ignored.
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
            <tr>
              <th className="text-left px-5 py-3 font-semibold w-12">Row</th>
              <th className="text-left px-5 py-3 font-semibold">Name</th>
              <th className="text-left px-5 py-3 font-semibold">Category</th>
              <th className="text-left px-5 py-3 font-semibold">City</th>
              <th className="text-left px-5 py-3 font-semibold">Contents</th>
              <th className="text-left px-5 py-3 font-semibold">Notes</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {result.listings.map((l) => {
              const blocked = l.errors.length > 0;
              const skip = skipped.has(l.rowNumber);
              return (
                <tr key={l.rowNumber} className={blocked || skip ? 'bg-slate-50/60' : ''}>
                  <td className="px-5 py-3 text-slate-300 text-xs">{l.rowNumber}</td>
                  <td className={`px-5 py-3 font-semibold ${blocked || skip ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                    {l.fields.name || <span className="italic text-slate-300">no name</span>}
                  </td>
                  <td className="px-5 py-3 text-slate-500">{LISTING_CATEGORY_LABELS[l.category]}</td>
                  <td className="px-5 py-3 text-slate-500">{l.fields.city || '—'}</td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    <Contents listing={l} />
                  </td>
                  <td className="px-5 py-3">
                    {l.errors.map((e) => (
                      <p key={e} className="text-xs text-rose-600 flex items-start gap-1">
                        <span className="material-symbols-outlined text-[14px] mt-px">cancel</span>{e}
                      </p>
                    ))}
                    {l.warnings.map((w) => (
                      <p key={w} className="text-xs text-amber-700 flex items-start gap-1">
                        <span className="material-symbols-outlined text-[14px] mt-px">warning</span>{w}
                      </p>
                    ))}
                    {l.errors.length === 0 && l.warnings.length === 0 && (
                      <span className="text-xs text-emerald-600">Ready</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {!blocked && (
                      <button
                        type="button"
                        onClick={() => onToggleSkip(l.rowNumber)}
                        className="text-xs font-semibold text-slate-400 hover:text-slate-700"
                      >
                        {skip ? 'Include' : 'Skip'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100">
          Choose a different file
        </button>
        <button
          type="button"
          onClick={onStart}
          disabled={importableCount === 0}
          className="bg-emerald-500 hover:bg-emerald-600 text-white px-8 py-3.5 rounded-xl font-bold text-sm shadow-lg flex items-center gap-2 disabled:opacity-40 disabled:shadow-none"
        >
          Import {importableCount} listing{importableCount === 1 ? '' : 's'} as drafts
          <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
        </button>
      </div>
    </div>
  );
};

const Contents: React.FC<{ listing: ParsedListing }> = ({ listing: l }) => {
  const bits: string[] = [];
  const photos = l.imageFiles.length + l.imageUrls.length;
  if (photos) bits.push(`${photos} photo${photos === 1 ? '' : 's'}`);
  if (l.spaces.length) bits.push(`${l.spaces.length} hall${l.spaces.length === 1 ? '' : 's'}`);
  if (l.rooms.length) bits.push(`${l.rooms.length} room type${l.rooms.length === 1 ? '' : 's'}`);
  if (l.packages.length) bits.push(`${l.packages.length} package${l.packages.length === 1 ? '' : 's'}`);
  if (l.fields.amenities?.length) bits.push(`${l.fields.amenities.length} amenities`);
  return <>{bits.join(' · ') || '—'}</>;
};

const ResultsPanel: React.FC<{
  outcomes: ImportOutcome[];
  submitting: boolean;
  submitNote: string | null;
  onSubmitAll: () => void;
  onOpen: (id: string) => void;
  onAgain: () => void;
  onList: () => void;
}> = ({ outcomes, submitting, submitNote, onSubmitAll, onOpen, onAgain, onList }) => {
  const created = outcomes.filter((o) => o.listingId && !o.error);
  const failed = outcomes.filter((o) => o.error);
  const photoIssues = outcomes.filter((o) => o.photoError);

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-2xl border border-slate-100 p-8 space-y-2">
        <h2 className="font-geist text-xl font-semibold text-slate-800">
          {created.length} listing{created.length === 1 ? '' : 's'} created as drafts
        </h2>
        <p className="text-sm text-slate-500">
          Nothing is public. Open any of them to adjust, then send for approval.
        </p>
        {failed.length > 0 && (
          <p className="text-sm text-rose-600">{failed.length} row{failed.length === 1 ? '' : 's'} failed entirely.</p>
        )}
        {photoIssues.length > 0 && (
          <p className="text-sm text-amber-700">
            {photoIssues.length} imported but had photo problems — the text is fine, add the photos by hand.
          </p>
        )}
      </div>

      {submitNote && (
        <div className="bg-sky-50 border border-sky-200 text-sky-900 text-sm px-4 py-3 rounded-xl">{submitNote}</div>
      )}

      <div className="bg-white rounded-2xl border border-slate-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-400 text-[10px] uppercase tracking-widest">
            <tr>
              <th className="text-left px-5 py-3 font-semibold w-12">Row</th>
              <th className="text-left px-5 py-3 font-semibold">Name</th>
              <th className="text-left px-5 py-3 font-semibold">Photos</th>
              <th className="text-left px-5 py-3 font-semibold">Result</th>
              <th className="w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {outcomes.map((o) => (
              <tr key={o.rowNumber}>
                <td className="px-5 py-3 text-slate-300 text-xs">{o.rowNumber}</td>
                <td className="px-5 py-3 font-semibold text-slate-800">{o.name}</td>
                <td className="px-5 py-3 text-slate-500">{o.photosUploaded || '—'}</td>
                <td className="px-5 py-3">
                  {o.error ? (
                    <span className="text-xs text-rose-600">{o.error}</span>
                  ) : o.photoError ? (
                    <span className="text-xs text-amber-700">Created — {o.photoError}</span>
                  ) : (
                    <span className="text-xs text-emerald-600">Created</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {o.listingId && (
                    <button
                      type="button"
                      onClick={() => onOpen(o.listingId!)}
                      className="text-xs font-bold text-emerald-600 hover:text-emerald-700"
                    >
                      Open
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-3">
          <button type="button" onClick={onAgain} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-500 hover:bg-slate-100">
            Import another file
          </button>
          <button type="button" onClick={onList} className="px-5 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
            View all listings
          </button>
        </div>
        {created.length > 0 && (
          <button
            type="button"
            onClick={onSubmitAll}
            disabled={submitting}
            className="bg-slate-800 hover:bg-slate-900 text-white px-7 py-3 rounded-xl font-bold text-sm flex items-center gap-2 disabled:opacity-50"
          >
            {submitting ? 'Sending…' : `Send all ${created.length} for approval`}
            <span className="material-symbols-outlined text-[18px]">send</span>
          </button>
        )}
      </div>
    </div>
  );
};

const Step: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <div className="flex gap-4">
    <span className="shrink-0 w-7 h-7 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center">
      {n}
    </span>
    <div className="space-y-1">
      <p className="font-semibold text-sm text-slate-700">{title}</p>
      <div className="text-sm text-slate-500 leading-relaxed">{children}</div>
    </div>
  </div>
);

const Code: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <code className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[12px] font-mono">{children}</code>
);

const Example: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex gap-2 text-[12px]">
    <span className="text-slate-400 font-mono w-32 shrink-0">{label}</span>
    <span className="font-mono text-slate-600">{children}</span>
  </div>
);

const Pill: React.FC<{ tone: 'ok' | 'warn' | 'bad'; label: string }> = ({ tone, label }) => {
  const styles = {
    ok: 'bg-emerald-50 text-emerald-700',
    warn: 'bg-amber-50 text-amber-800',
    bad: 'bg-rose-50 text-rose-700',
  }[tone];
  return <span className={`text-xs font-bold px-3 py-1.5 rounded-lg ${styles}`}>{label}</span>;
};
