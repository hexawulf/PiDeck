import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Server, Eye, EyeOff } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { ThemeToggle } from "@/components/theme-toggle";
import { DbMigrationBanner } from "@/components/db-migration-banner";
import { TransportNotice } from "@/components/transport-notice";
import { signInWithGooglePopup } from "@/lib/firebase";

function GoogleIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" {...props}>
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.1-6.72-4.93H1.25v3.15C3.26 21.36 7.33 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.28 14.27c-.25-.72-.38-1.49-.38-2.27s.13-1.55.38-2.27V6.58H1.25C.45 8.18 0 9.99 0 12s.45 3.82 1.25 5.42l4.03-3.15Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.33 0 3.26 2.64 1.25 6.58l4.03 3.15c.95-2.83 3.6-4.98 6.72-4.98Z"
      />
    </svg>
  );
}

export default function Login() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isGoogleSigningIn, setIsGoogleSigningIn] = useState(false);
  const { login, firebaseLogin, isLoginPending, isFirebaseLoginPending, user } = useAuth();
  const { toast } = useToast();

  const handleGoogleLogin = async () => {
    if (!user?.firebase?.enabled) return;
    setIsGoogleSigningIn(true);
    try {
      const idToken = await signInWithGooglePopup(user.firebase);
      await firebaseLogin(idToken);
      toast({ title: "Success", description: "Logged in via Google" });
    } catch (error: unknown) {
      let errorMessage = "Google sign-in failed";
      if (error instanceof Error) {
        try {
          const parts = error.message.split(": ");
          const body = parts.length > 1 ? parts.slice(1).join(": ") : parts[0];
          const parsed = JSON.parse(body);
          errorMessage = parsed.message || errorMessage;
        } catch {
          errorMessage = error.message || errorMessage;
        }
      }
      toast({
        title: "Login Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsGoogleSigningIn(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!password.trim()) {
      toast({
        title: "Error",
        description: "Password is required",
        variant: "destructive",
      });
      return;
    }

    try {
      await login(password);
      toast({ title: "Success", description: "Login successful" });
    } catch (error: unknown) {
      let errorMessage = "Invalid password";
      if (error instanceof Error) {
        try {
          const parts = error.message.split(": ");
          const body = parts.length > 1 ? parts.slice(1).join(": ") : parts[0];
          const parsed = JSON.parse(body);
          errorMessage = parsed.message || errorMessage;
        } catch {
          errorMessage = error.message || errorMessage;
        }
      }
      toast({
        title: "Login Failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const isBusy = isLoginPending || isFirebaseLoginPending || isGoogleSigningIn;
  const firebaseEnabled = user?.firebase?.enabled === true;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pi-darker to-pi-dark">
      <ThemeToggle className="fixed top-4 right-4" />
      <div className="max-w-md w-full mx-4">
        <Card className="bg-pi-card border-pi-border shadow-2xl">
          <CardContent className="p-8">
            <div className="text-center mb-8">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-pi-accent rounded-lg flex items-center justify-center">
                  <Server className="w-6 h-6 text-pi-on-accent" />
                </div>
              </div>
              <Link href="/dashboard">
                <h1 className="text-2xl font-bold pi-text mb-2 cursor-pointer hover:text-primary">PiDeck</h1>
              </Link>
              <p className="pi-text-muted">Raspberry Pi Admin Dashboard</p>
            </div>
            
            <TransportNotice transport={user?.transport} />
            {user?.maintenance?.dbMigrationsPending && <DbMigrationBanner />}

            {firebaseEnabled && (
              <div className="mb-6 space-y-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleGoogleLogin}
                  disabled={isBusy}
                  className="w-full flex items-center justify-center gap-3 py-3 px-4 border-pi-border bg-pi-darker hover:bg-pi-card text-pi-text transition-colors duration-200"
                >
                  <GoogleIcon className="w-5 h-5 flex-shrink-0" />
                  <span className="font-medium">
                    {isGoogleSigningIn || isFirebaseLoginPending ? "Authenticating with Google..." : "Sign in with Google"}
                  </span>
                </Button>

                <div className="relative my-6">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-pi-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-pi-card px-2 text-pi-text-muted">or continue with password</span>
                  </div>
                </div>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label className="block text-sm font-medium pi-text-muted mb-2">
                  {firebaseEnabled ? "Local Admin Password (Break-Glass)" : "Password"}
                </Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full px-4 py-3 bg-pi-darker border-pi-border text-pi-text placeholder:text-pi-text-muted focus:ring-2 focus:ring-pi-accent focus:border-transparent pr-10"
                    disabled={isBusy}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 pi-text-muted hover:pi-text transition-colors"
                  >
                    {showPassword ? (
                      <EyeOff className="w-4 h-4" />
                    ) : (
                      <Eye className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
              
              <Button 
                type="submit" 
                className="w-full bg-pi-accent hover:bg-pi-accent-hover text-pi-on-accent font-semibold py-3 px-4 transition-colors duration-200"
                disabled={isBusy}
              >
                {isLoginPending ? "Signing In..." : "Sign In with Password"}
              </Button>
            </form>
            
            <div className="mt-6 text-center">
              <p className="text-xs pi-text-muted">Secure homelab dashboard</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
