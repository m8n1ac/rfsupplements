"use client";

import Image from "next/image";
import Link from "next/link";
import { useActionState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  confirmInviteTotp,
  setInvitePassword,
  type PasswordState,
  type TotpState,
} from "@/app/invite/[token]/actions";

type Props =
  | { token: string; step: "password" }
  | { token: string; step: "totp"; qrDataUrl: string; secret: string };

export function InviteFlow(props: Props) {
  if (props.step === "password") {
    return <PasswordStep token={props.token} />;
  }
  return <TotpStep token={props.token} qrDataUrl={props.qrDataUrl} secret={props.secret} />;
}

function PasswordStep({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(
    setInvitePassword.bind(null, token),
    { error: null } satisfies PasswordState,
  );

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label htmlFor="password">Choose a password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
        <p className="text-muted-foreground text-xs">At least 12 characters.</p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={12}
          required
        />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Continue"}
      </Button>
    </form>
  );
}

function TotpStep({
  token,
  qrDataUrl,
  secret,
}: {
  token: string;
  qrDataUrl: string;
  secret: string;
}) {
  const [state, formAction, pending] = useActionState(
    confirmInviteTotp.bind(null, token),
    { error: null, recoveryCodes: null } satisfies TotpState,
  );

  if (state.recoveryCodes) {
    return <RecoveryCodes codes={state.recoveryCodes} />;
  }

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-2">
        <Label>Scan this with your authenticator app</Label>
        <Image
          src={qrDataUrl}
          alt="TOTP enrolment QR code"
          width={200}
          height={200}
          unoptimized
          className="self-center rounded border"
        />
        <p className="text-muted-foreground text-xs break-all">
          Cannot scan? Enter this key manually: <code>{secret}</code>
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="code">Enter the 6-digit code</Label>
        <Input
          id="code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
        />
      </div>
      {state.error ? (
        <Alert variant="destructive">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Checking…" : "Finish setup"}
      </Button>
    </form>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="grid gap-4">
      <Alert>
        <AlertDescription>
          Save these recovery codes somewhere safe. Each one can be used once, in
          place of your authenticator code. <strong>They will not be shown again.</strong>
        </AlertDescription>
      </Alert>
      <ul className="bg-muted grid grid-cols-2 gap-2 rounded p-4 font-mono text-sm">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <Button asChild>
        <Link href="/login">Go to sign in</Link>
      </Button>
    </div>
  );
}
