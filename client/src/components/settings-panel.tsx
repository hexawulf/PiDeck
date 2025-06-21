import React, { useState } from 'react';
import { useForm, SubmitHandler } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuth } from '@/hooks/use-auth'; // Corrected import
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';

const passwordChangeFormSchema = z.object({
  currentPassword: z.string().min(1, { message: "Current password is required." }),
  newPassword: z.string()
    .min(8, { message: "Password must be at least 8 characters long." })
    .regex(/[a-z]/, { message: "Password must contain at least one lowercase letter." })
    .regex(/[A-Z]/, { message: "Password must contain at least one uppercase letter." })
    .regex(/[0-9]/, { message: "Password must contain at least one number." })
    .regex(/[^a-zA-Z0-9]/, { message: "Password must contain at least one special character." }),
  confirmNewPassword: z.string().min(1, { message: "Please confirm your new password." }),
}).refine(data => data.newPassword === data.confirmNewPassword, {
  message: "New passwords do not match.",
  path: ["confirmNewPassword"],
});

type PasswordChangeFormValues = z.infer<typeof passwordChangeFormSchema>;

interface SettingsMessage {
  type: 'success' | 'error';
  text: string;
}

const SettingsPanel: React.FC = () => {
  const { changePassword, isChangingPassword, changePasswordError } = useAuth();
  const [message, setMessage] = useState<SettingsMessage | null>(null);

  const { register, handleSubmit, formState: { errors }, reset } = useForm<PasswordChangeFormValues>({
    resolver: zodResolver(passwordChangeFormSchema),
  });

  const onSubmit: SubmitHandler<PasswordChangeFormValues> = async (formData) => {
    setMessage(null);
    try {
      // The changePassword mutation expects an object with currentPassword, newPassword, confirmNewPassword
      await changePassword({
        currentPassword: formData.currentPassword,
        newPassword: formData.newPassword,
        confirmNewPassword: formData.confirmNewPassword // Pass for backend Zod check consistency
      });
      setMessage({ type: 'success', text: 'Password changed successfully!' });
      reset();
    } catch (error: any) {
      // error.message here will likely be the generic Tanstack Query error message.
      // The actual error from the API (if structured as { message: "..." }) is often in error.response.data.message
      const apiErrorMessage = error?.response?.data?.message || 'Failed to change password. Please try again.';
      setMessage({ type: 'error', text: apiErrorMessage });
      console.error("Change password error details:", error.response?.data || error);
    }
    // isChangingPassword is handled by useAuth hook now
  };

  // Display general error from the hook if it exists and no specific form message is set
  // This is less common for form submissions but can be a fallback.
  // Usually, the catch block in onSubmit is sufficient.
  React.useEffect(() => {
    if (changePasswordError && !message) {
      setMessage({ type: 'error', text: changePasswordError || "An unexpected error occurred." });
    }
  }, [changePasswordError, message]);


  return (
    <Card className="w-full max-w-lg mx-auto bg-pi-card border-pi-border">
      <CardHeader>
        <CardTitle className="text-2xl pi-text">Change Password</CardTitle>
        <CardDescription className="pi-text-muted">
          Update your account password. Choose a strong, unique password.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {message && (
            <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'border-green-500 text-green-700 dark:border-green-600 dark:text-green-400' : ''}>
              {message.type === 'success' ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}
              <AlertTitle>{message.type === 'success' ? 'Success' : 'Error'}</AlertTitle>
              <AlertDescription>{message.text}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <Label htmlFor="currentPassword" style={{color: 'var(--pi-text)'}}>Current Password</Label>
            <Input
              id="currentPassword"
              type="password"
              {...register("currentPassword")}
              className="bg-pi-input border-pi-border focus:ring-pi-accent"
              autoComplete="current-password"
            />
            {errors.currentPassword && <p className="text-sm text-pi-error">{errors.currentPassword.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="newPassword" style={{color: 'var(--pi-text)'}}>New Password</Label>
            <Input
              id="newPassword"
              type="password"
              {...register("newPassword")}
              className="bg-pi-input border-pi-border focus:ring-pi-accent"
              autoComplete="new-password"
            />
            {errors.newPassword && <p className="text-sm text-pi-error">{errors.newPassword.message}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirmNewPassword" style={{color: 'var(--pi-text)'}}>Confirm New Password</Label>
            <Input
              id="confirmNewPassword"
              type="password"
              {...register("confirmNewPassword")}
              className="bg-pi-input border-pi-border focus:ring-pi-accent"
              autoComplete="new-password"
            />
            {errors.confirmNewPassword && <p className="text-sm text-pi-error">{errors.confirmNewPassword.message}</p>}
          </div>

          <Button type="submit" className="w-full bg-pi-accent hover:bg-pi-accent-hover text-white" disabled={isChangingPassword}>
            {isChangingPassword ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Changing...
              </>
            ) : (
              'Change Password'
            )}
          </Button>
        </form>
      </CardContent>
      <CardFooter>
        <p className="text-xs pi-text-muted text-center w-full">
          Ensure your new password is at least 8 characters long and includes uppercase, lowercase, number, and special characters.
        </p>
      </CardFooter>
    </Card>
  );
};

export default SettingsPanel;
