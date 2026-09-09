export default function OrgLoading() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Hero skeleton */}
      <div className="relative h-48 bg-gray-200 animate-pulse">
        <div className="absolute bottom-4 left-4 flex items-end gap-4">
          <div className="w-20 h-20 rounded-xl bg-gray-300 animate-pulse" />
          <div>
            <div className="h-6 w-40 bg-gray-300 rounded animate-pulse mb-2" />
            <div className="h-4 w-28 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* About skeleton */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <div className="h-5 w-24 bg-gray-200 rounded animate-pulse mb-3" />
          <div className="space-y-2">
            <div className="h-3 bg-gray-100 rounded animate-pulse" />
            <div className="h-3 bg-gray-100 rounded animate-pulse w-5/6" />
            <div className="h-3 bg-gray-100 rounded animate-pulse w-4/6" />
          </div>
        </div>

        {/* Specialists skeleton */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <div className="h-5 w-32 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="flex items-center gap-3 p-3 rounded-lg border border-gray-100"
              >
                <div className="w-10 h-10 bg-gray-200 rounded-full animate-pulse flex-shrink-0" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded animate-pulse mb-1 w-3/4" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Courses skeleton */}
        <div className="bg-white rounded-xl p-5 shadow-sm">
          <div className="h-5 w-28 bg-gray-200 rounded animate-pulse mb-4" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3 p-3 rounded-lg border border-gray-100">
                <div className="w-16 h-16 bg-gray-200 rounded-lg animate-pulse flex-shrink-0" />
                <div className="flex-1">
                  <div className="h-4 bg-gray-200 rounded animate-pulse mb-2 w-3/4" />
                  <div className="h-3 bg-gray-100 rounded animate-pulse w-1/2 mb-3" />
                  <div className="h-8 w-28 bg-gray-200 rounded-lg animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
