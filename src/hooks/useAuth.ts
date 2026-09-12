import { trpc } from "@/lib/trpc";
import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "react-router";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = "/" } =
    options ?? {};

  const navigate = useNavigate();

  const utils = trpc.useUtils();

  const {
    data: user,
    isLoading,
    error,
    refetch,
  } = trpc.auth.me.useQuery(undefined, {
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      // Navigasi lebih dulu agar query room/voice yang sedang dipolling tidak
      // sempat merender halaman error setelah cookie sesi dihapus.
      navigate(redirectPath, { replace: true });
      void utils.invalidate();
    },
  });

  const logout = useCallback(() => logoutMutation.mutate(), [logoutMutation]);
  // React Query mempertahankan data terakhir saat refetch `auth.me` gagal.
  // Jangan tampilkan identitas lama setelah cookie sesi sudah tidak valid.
  const sessionExpired =
    error?.data?.code === "UNAUTHORIZED" || error?.data?.code === "FORBIDDEN";
  const authenticatedUser = sessionExpired ? null : user ?? null;

  useEffect(() => {
    if (redirectOnUnauthenticated && !isLoading && !authenticatedUser) {
      const currentPath = window.location.pathname;
      if (currentPath !== redirectPath) {
        navigate(redirectPath, { replace: true });
      }
    }
  }, [
    redirectOnUnauthenticated,
    isLoading,
    authenticatedUser,
    navigate,
    redirectPath,
  ]);

  return useMemo(
    () => ({
      user: authenticatedUser,
      isAuthenticated: !!authenticatedUser,
      isLoading: isLoading || logoutMutation.isPending,
      error,
      logout,
      refresh: refetch,
    }),
    [
      authenticatedUser,
      isLoading,
      logoutMutation.isPending,
      error,
      logout,
      refetch,
    ],
  );
}
