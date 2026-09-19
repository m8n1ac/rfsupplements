-- CreateTable
CREATE TABLE `Affiliate` (
    `id` VARCHAR(191) NOT NULL,
    `wooId` INTEGER NOT NULL,
    `wpUserId` INTEGER NULL,
    `contactId` VARCHAR(191) NULL,
    `email` VARCHAR(191) NOT NULL,
    `paymentEmail` VARCHAR(191) NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `commissionType` VARCHAR(191) NOT NULL,
    `commissionRate` DECIMAL(8, 2) NOT NULL,
    `referralCount` INTEGER NOT NULL DEFAULT 0,
    `paidCommission` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `unpaidCommission` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `rejectedCommission` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `referredRevenue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `lastReferralAt` DATETIME(3) NULL,
    `createdAtWoo` DATETIME(3) NULL,
    `modifiedAtWoo` DATETIME(3) NULL,
    `syncedAt` DATETIME(3) NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Affiliate_wooId_key`(`wooId`),
    UNIQUE INDEX `Affiliate_contactId_key`(`contactId`),
    INDEX `Affiliate_status_idx`(`status`),
    INDEX `Affiliate_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Referral` (
    `id` VARCHAR(191) NOT NULL,
    `wooId` INTEGER NOT NULL,
    `affiliateId` VARCHAR(191) NOT NULL,
    `orderWooId` INTEGER NULL,
    `orderAmount` DECIMAL(12, 2) NOT NULL,
    `commissionAmount` DECIMAL(12, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `referralType` VARCHAR(191) NULL,
    `referralSource` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `refundedAtWoo` DATETIME(3) NULL,
    `createdAtWoo` DATETIME(3) NULL,
    `modifiedAtWoo` DATETIME(3) NULL,
    `syncedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Referral_wooId_key`(`wooId`),
    INDEX `Referral_affiliateId_idx`(`affiliateId`),
    INDEX `Referral_status_idx`(`status`),
    INDEX `Referral_orderWooId_idx`(`orderWooId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Affiliate` ADD CONSTRAINT `Affiliate_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Referral` ADD CONSTRAINT `Referral_affiliateId_fkey` FOREIGN KEY (`affiliateId`) REFERENCES `Affiliate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
