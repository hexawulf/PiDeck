import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

interface AuthStatus {
  authenticated: boolean;
  userId?: number;
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
