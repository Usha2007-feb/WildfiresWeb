export default function Loading() {
  return (
    <div className="flex h-[calc(100vh-64px)] items-center justify-center bg-[#F8FAFC]">
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-blue-600 border-t-transparent" />
        <p className="text-[14px] font-medium text-slate-500">Loading...</p>
      </div>
    </div>
  );
}
