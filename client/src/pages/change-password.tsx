import { useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Server } from "lucide-react";

export default function ChangePassword() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const { changePassword, isChangingPassword } = useAuth();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      toast({
        title: "Error",
        description: "All fields are required",
        variant: "destructive",
      });
      return;
    }

    if (newPassword !== confirmNewPassword) {
      toast({
        title: "Error",
        description: "New passwords do not match",
        variant: "destructive",
      });
      return;
    }

    try {
      await changePassword({ currentPassword, newPassword, confirmNewPassword });
      toast({ title: "Success", description: "Password changed successfully" });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to change password",
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
                <h1 className="text-2xl font-bold cursor-pointer hover:text-primary pi-text mb-2">PiDeck</h1>
              </Link>
              <p className="pi-text-muted">Change Password</p>
            </div>
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <Label className="block text-sm font-medium pi-text-muted mb-2">Current Password</Label>
                <Input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-pi-darker border-pi-border pi-text placeholder:pi-text-muted focus:ring-2 focus:ring-pi-accent focus:border-transparent"
                />
              </div>
              <div>
                <Label className="block text-sm font-medium pi-text-muted mb-2">New Password</Label>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-pi-darker border-pi-border pi-text placeholder:pi-text-muted focus:ring-2 focus:ring-pi-accent focus:border-transparent"
                />
              </div>
              <div>
                <Label className="block text-sm font-medium pi-text-muted mb-2">Confirm New Password</Label>
                <Input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-pi-darker border-pi-border pi-text placeholder:pi-text-muted focus:ring-2 focus:ring-pi-accent focus:border-transparent"
                />
              </div>
              <Button
                type="submit"
                className="w-full pi-accent hover:bg-blue-600 text-white font-semibold py-3 px-4 transition-colors duration-200"
                disabled={isChangingPassword}
              >
                {isChangingPassword ? "Updating..." : "Update Password"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
