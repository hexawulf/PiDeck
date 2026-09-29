import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

interface AuthStatus {
  authenticated: boolean;
  userId?: number;
  /** How the session cookie is sent (see components/transport-notice.tsx). */
  transport?: { secureCookie: boolean; insecureHttp: boolean };
  /** Schema migrations are pending (hub serves anyway; see server/db-schema.ts). */
  maintenance?: { dbMigrationsPending: boolean };
  /** Signed in and the admin password is still the seeded default. */
  defaultPassword?: boolean;
  /** PIDECK_HISTORY_HOURS on the hub (2.6+): charts offer 3d/7d only when that much is kept. */
  historyHours?: number;
}

export function useAuth() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery<AuthStatus>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/auth/me");
      return res.json();
    },
    retry: false,
  });

  const loginMutation = useMutation({
    mutationFn: async (password: string) => {
      const res = await apiRequest("POST", "/api/auth/login", { password });
      return res.json();
    },
    onSuccess: (data: { authenticated: boolean; userId?: number }) => {
      if (data?.authenticated) {
        queryClient.setQueryData(["/api/auth/me"], data);
      } else {
        queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      }
      setLocation("/dashboard");
    },
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/login");
    },
  });

  const changePasswordMutation = useMutation({
    mutationFn: async (data: { currentPassword?: string; newPassword?: string; confirmNewPassword?: string }) => {
      return apiRequest("POST", "/api/auth/change-password", {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        confirmNewPassword: data.confirmNewPassword,
      });
    },
  });

  return {
    user,
    isLoading,
    isAuthenticated: user?.authenticated === true,
    login: loginMutation.mutateAsync,
    logout: logoutMutation.mutateAsync,
    changePassword: changePasswordMutation.mutateAsync,
    isLoginPending: loginMutation.isPending,
    isLogoutPending: logoutMutation.isPending,
    isChangingPassword: changePasswordMutation.isPending,
    loginError: loginMutation.error?.message,
    changePasswordError: changePasswordMutation.error?.message,
  };
}
