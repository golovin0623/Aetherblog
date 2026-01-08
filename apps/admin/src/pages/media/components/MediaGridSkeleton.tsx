import { Skeleton } from "@/components/ui/skeleton";

export function MediaGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 animate-in fade-in duration-500">
      {Array.from({ length: 12 }).map((_, i) => (
        <div 
          key={i} 
          className="group relative aspect-square rounded-2xl overflow-hidden bg-white/5 border border-white/5"
        >
          {/* Skeleton for the media content */}
          <Skeleton className="w-full h-full bg-white/5" />
          
          {/* Skeleton for the footer/info area */}
          <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
            <Skeleton className="h-4 w-2/3 bg-white/10 mb-2 rounded" />
            <div className="flex justify-between items-center">
               <Skeleton className="h-3 w-8 bg-white/10 rounded" />
               <Skeleton className="h-3 w-12 bg-white/10 rounded" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
