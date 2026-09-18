import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

// Every chart sits in the same frame, so the dashboard reads as one system.
export function ChartShell({
  title,
  description,
  children,
  aside,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className="grid gap-4">
        {children}
        {aside}
      </CardContent>
    </Card>
  );
}
