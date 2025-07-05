import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";

export function useAuth() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();

  const { data: user, isLoading } = useQuery({
    queryKey: ["/api/auth/me"],
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
      // The backend expects currentPassword and newPassword. confirmNewPassword is for client-side validation.
      return apiRequest("POST", "/api/auth/change-password", {
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
        confirmNewPassword: data.confirmNewPassword, // Send it for Zod validation on backend too
      });
    },
    // No specific onSuccess needed here unless we want to invalidate user queries or show global toast.
    // Component-level feedback is usually better for password change.
  });

  return {
    user, // Contains { authenticated: boolean, userId?: number }
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
