import { useQuery } from "@tanstack/react-query";
import { cameraService } from "@/services/cameras";

const statusDot = {
  online: "bg-green-500",
  offline: "bg-red-500",
  error: "bg-yellow-500",
};

export default function CamerasPage() {
  const { data: cameras, isLoading } = useQuery({
    queryKey: ["cameras"],
    queryFn: () => cameraService.getAll(),
    refetchInterval: 15000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Cameras</h2>
        <p className="text-gray-500 mt-1">Manage your camera feeds</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {cameras?.map((camera) => (
          <div key={camera.id} className="card">
            <div className="aspect-video bg-gray-900 rounded-lg mb-4 flex items-center justify-center">
              <span className="text-gray-500 text-sm">Camera Feed</span>
            </div>

            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900">{camera.name}</h3>
              <span
                className={`inline-block w-2.5 h-2.5 rounded-full ${statusDot[camera.status]}`}
              />
            </div>

            <p className="text-sm text-gray-500 mb-1">{camera.location}</p>
            <p className="text-sm text-gray-400">
              Last seen: {new Date(camera.lastSeen).toLocaleString()}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
