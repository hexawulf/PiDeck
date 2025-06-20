import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Server, Eye, EyeOff } from "lucide-react";
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
      await login(password);
      toast({
        title: "Success",
        description: "Login successful",
      });
    } catch (error) {
      toast({
        title: "Login Failed",
        description: loginError || "Invalid password",
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
              <h1 className="text-2xl font-bold pi-text mb-2">PiDeck</h1>
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
