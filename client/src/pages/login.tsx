import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Server, Eye, EyeOff } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

export default function Login() {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { login, isLoginPending, loginError } = useAuth();
  const { toast } = useToast();

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
      // Attempt login
      await login(password);

      // Verify session by checking /api/auth/me
      const meResponse = await fetch('/api/auth/me', {
        credentials: 'include'
      });

      if (meResponse.ok) {
        const meData = await meResponse.json();
        if (meData.authenticated) {
          toast({
            title: "Success",
            description: "Login successful",
          });
          return;
        }
      }

      // Session verification failed
      toast({
        title: "Login Failed",
        description: "Session could not be established. Please try again.",
        variant: "destructive",
      });

    } catch (error: any) {
      // Extract X-Auth-Reason from error if available
      let errorMessage = loginError || "Invalid password";

      // Try to parse error for more details
      if (error?.message) {
        try {
          const errorData = JSON.parse(error.message.split(': ')[1]);
          if (errorData.reason) {
            const reasonMap: Record<string, string> = {
              'bad_password_compare': 'Invalid password',
              'missing_password': 'Password is required',
              'locked_out': 'Account locked due to too many failed attempts',
              'origin_blocked': 'Request blocked by security policy',
              'session_write_failed': 'Session could not be saved',
              'bad_body_parse': 'Invalid request format'
            };
            errorMessage = reasonMap[errorData.reason] || errorData.message || errorMessage;
          } else if (errorData.message) {
            errorMessage = errorData.message;
          }
        } catch {
          // Keep default error message
        }
      }

      toast({
        title: "Login Failed",
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-pi-darker to-pi-dark">
      <div className="max-w-md w-full mx-4">
        <Card className="bg-pi-card border-pi-border shadow-2xl">
          <CardContent className="p-8">
            <div className="text-center mb-8">
              <div className="flex items-center justify-center mb-4">
                <div className="w-12 h-12 bg-pi-accent rounded-lg flex items-center justify-center">
                  <Server className="w-6 h-6 text-white" />
                </div>
              </div>
              <Link href="/dashboard">
                <h1 className="text-2xl font-bold pi-text mb-2 cursor-pointer hover:text-primary">PiDeck</h1>
              </Link>
              <p className="pi-text-muted">Raspberry Pi Admin Dashboard</p>
            </div>
            
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label className="block text-sm font-medium pi-text-muted mb-2">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter admin password"
                    className="w-full px-4 py-3 bg-pi-darker border-pi-border pi-text placeholder:pi-text-muted focus:ring-2 focus:ring-pi-accent focus:border-transparent pr-10"
                    disabled={isLoginPending}
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
                className="w-full pi-accent hover:bg-blue-600 text-white font-semibold py-3 px-4 transition-colors duration-200"
                disabled={isLoginPending}
              >
                {isLoginPending ? "Signing In..." : "Sign In"}
              </Button>
            </form>
            
            <div className="mt-6 text-center">
              <p className="text-xs pi-text-muted">Secure localhost access only</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
