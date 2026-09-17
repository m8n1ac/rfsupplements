import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/require-user";
import { CreateUserForm, UserRowActions } from "@/app/(app)/settings/users/user-forms";

export const metadata: Metadata = { title: "Users · RF Supplements Ops" };

export default async function UsersPage() {
  const admin = await requireUser("ADMIN");

  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      name: true,
      role: true,
      active: true,
      lastLoginAt: true,
      passwordHash: true,
      totpEnrolledAt: true,
    },
  });

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Users</h1>
        <p className="text-muted-foreground">
          Administrators create accounts. There is no self-signup, and every user
          must enrol an authenticator app before they can sign in.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Invite someone</CardTitle>
          <CardDescription>
            They receive a single-use link that expires in 24 hours.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CreateUserForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last sign-in</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const pending = !user.passwordHash || !user.totpEnrolledAt;
                return (
                  <TableRow key={user.id}>
                    <TableCell>{user.name}</TableCell>
                    <TableCell>{user.email}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{user.role}</Badge>
                    </TableCell>
                    <TableCell>
                      {!user.active ? (
                        <Badge variant="destructive">Deactivated</Badge>
                      ) : pending ? (
                        <Badge variant="outline">Setup pending</Badge>
                      ) : (
                        <Badge>Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {user.lastLoginAt ? user.lastLoginAt.toISOString().slice(0, 16).replace("T", " ") : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <UserRowActions
                        userId={user.id}
                        active={user.active}
                        pending={pending}
                        isSelf={user.id === admin.id}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
