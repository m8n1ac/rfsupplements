/*
  Warnings:

  - You are about to drop the column `totpEnrolledAt` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `totpSecret` on the `User` table. All the data in the column will be lost.
  - You are about to drop the `RecoveryCode` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `RecoveryCode` DROP FOREIGN KEY `RecoveryCode_userId_fkey`;

-- AlterTable
ALTER TABLE `User` DROP COLUMN `totpEnrolledAt`,
    DROP COLUMN `totpSecret`;

-- DropTable
DROP TABLE `RecoveryCode`;
