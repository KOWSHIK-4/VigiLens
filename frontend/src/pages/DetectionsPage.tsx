import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { detectionService } from "@/services/detections";
import DetectionCard from "@/components/DetectionCard";

export default function DetectionsPage() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["detections", page, status],
    queryFn: () => detectionService.getAll({ page, limit: 20, status }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Detections</h2>
          <p className="text-gray-500 mt-1">
            All security events and alerts
          </p>
        </div>

        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
          className="input w-48"
        >
          <option value="">All Status</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {data?.data.map((detection) => (
              <DetectionCard key={detection.id} detection={detection} />
            ))}
          </div>

          <div className="flex items-center justify-between pt-4">
            <p className="text-sm text-gray-500">
              Showing {(page - 1) * 20 + 1}-
              {Math.min(page * 20, data?.total ?? 0)} of {data?.total}
            </p>

            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary text-sm"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => p + 1)}
                disabled={(page * 20) >= (data?.total ?? 0)}
                className="btn-secondary text-sm"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
