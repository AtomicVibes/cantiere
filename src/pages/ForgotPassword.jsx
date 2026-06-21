import React, { useState } from "react";
import { useTranslation } from 'react-i18next';
import { Link } from "react-router-dom";
import { resetPasswordRequest } from "@/services/authService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Mail, ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import AuthLayout from "@/components/AuthLayout";

export default function ForgotPassword() {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    const result = await resetPasswordRequest(email);
    setLoading(false);
    if (result) {
      setSent(true);
    } else {
      toast.error("Failed to send reset link. Please try again.");
    }
  };

  return (
    <AuthLayout
      title={t('resetPassword')}
      subtitle="We'll send you a link to reset it"
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          <ArrowLeft className="w-3 h-3 inline mr-1" />{t('backToLogin')}
        </Link>
      }
    >
      {sent ? (
        <p className="text-sm text-foreground text-center">
          {t('resetSentMessage')}
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">{t('emailAddress')}</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="email"
                type="email"
                autoComplete="email"
                autoFocus
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-10 h-12"
                required
              />
            </div>
          </div>
          <Button type="submit" className="w-full h-12 font-medium" disabled={loading}>
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                {t('sending')}
              </>
            ) : t('sendResetLink')}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
