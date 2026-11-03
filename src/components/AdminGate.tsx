import { Navigate } from "react-router-dom";
import { useAdminRole } from "@/hooks/useAdminRole";

/** Only signed-in admins can see the children; everyone else goes to the admin sign-in. */
export function AdminGate({ children }: { children: React.ReactNode }) {
  const { isAdmin, isLoading } = useAdminRole();
  if (isLoading) return <div className="min-h-screen bg-background" />;
  if (!isAdmin) return <Navigate to="/admin-login" replace />;
  return <>{children}</>;
}
