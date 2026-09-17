-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NULL,
    `role` ENUM('ADMIN', 'STAFF') NOT NULL DEFAULT 'STAFF',
    `totpSecret` TEXT NULL,
    `totpEnrolledAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `failedLogins` INTEGER NOT NULL DEFAULT 0,
    `lockedUntil` DATETIME(3) NULL,
    `lastLoginAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_email_idx`(`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RecoveryCode` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `codeHash` VARCHAR(255) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `RecoveryCode_userId_idx`(`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Invite` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(255) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `acceptedAt` DATETIME(3) NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Invite_tokenHash_key`(`tokenHash`),
    INDEX `Invite_userId_idx`(`userId`),
    INDEX `Invite_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Contact` (
    `id` VARCHAR(191) NOT NULL,
    `wooCustomerId` INTEGER NULL,
    `email` VARCHAR(191) NOT NULL,
    `firstName` VARCHAR(191) NULL,
    `lastName` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `company` VARCHAR(191) NULL,
    `billing` JSON NULL,
    `shipping` JSON NULL,
    `source` ENUM('WOO_CUSTOMER', 'WOO_GUEST', 'FORM', 'MANUAL') NOT NULL,
    `ownerId` VARCHAR(191) NULL,
    `ordersCount` INTEGER NOT NULL DEFAULT 0,
    `lifetimeValue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `avgOrderValue` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `firstOrderAt` DATETIME(3) NULL,
    `lastOrderAt` DATETIME(3) NULL,
    `modifiedAtWoo` DATETIME(3) NULL,
    `deletedInWoo` BOOLEAN NOT NULL DEFAULT false,
    `syncedAt` DATETIME(3) NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Contact_wooCustomerId_key`(`wooCustomerId`),
    UNIQUE INDEX `Contact_email_key`(`email`),
    INDEX `Contact_lastOrderAt_idx`(`lastOrderAt`),
    INDEX `Contact_ownerId_idx`(`ownerId`),
    INDEX `Contact_source_idx`(`source`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tag` (
    `id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Tag_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ContactTag` (
    `contactId` VARCHAR(191) NOT NULL,
    `tagId` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `ContactTag_tagId_idx`(`tagId`),
    PRIMARY KEY (`contactId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Product` (
    `id` VARCHAR(191) NOT NULL,
    `wooId` INTEGER NOT NULL,
    `parentWooId` INTEGER NULL,
    `sku` VARCHAR(191) NULL,
    `name` TEXT NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `price` DECIMAL(12, 2) NULL,
    `regularPrice` DECIMAL(12, 2) NULL,
    `salePrice` DECIMAL(12, 2) NULL,
    `stockStatus` VARCHAR(191) NULL,
    `stockQuantity` INTEGER NULL,
    `categories` JSON NULL,
    `modifiedAtWoo` DATETIME(3) NULL,
    `deletedInWoo` BOOLEAN NOT NULL DEFAULT false,
    `syncedAt` DATETIME(3) NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Product_wooId_key`(`wooId`),
    INDEX `Product_parentWooId_idx`(`parentWooId`),
    INDEX `Product_sku_idx`(`sku`),
    INDEX `Product_status_idx`(`status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Order` (
    `id` VARCHAR(191) NOT NULL,
    `wooId` INTEGER NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `currency` VARCHAR(8) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `discountTotal` DECIMAL(12, 2) NOT NULL,
    `shippingTotal` DECIMAL(12, 2) NOT NULL,
    `taxTotal` DECIMAL(12, 2) NOT NULL,
    `refundTotal` DECIMAL(12, 2) NOT NULL DEFAULT 0,
    `paymentMethod` VARCHAR(191) NULL,
    `paymentMethodTitle` VARCHAR(191) NULL,
    `couponCodes` JSON NULL,
    `billing` JSON NULL,
    `shipping` JSON NULL,
    `customerNote` TEXT NULL,
    `createdAtWoo` DATETIME(3) NOT NULL,
    `paidAtWoo` DATETIME(3) NULL,
    `completedAtWoo` DATETIME(3) NULL,
    `modifiedAtWoo` DATETIME(3) NULL,
    `deletedInWoo` BOOLEAN NOT NULL DEFAULT false,
    `syncedAt` DATETIME(3) NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Order_wooId_key`(`wooId`),
    INDEX `Order_createdAtWoo_idx`(`createdAtWoo`),
    INDEX `Order_status_idx`(`status`),
    INDEX `Order_contactId_idx`(`contactId`),
    INDEX `Order_paidAtWoo_idx`(`paidAtWoo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `OrderItem` (
    `id` VARCHAR(191) NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `wooLineItemId` INTEGER NOT NULL,
    `productWooId` INTEGER NULL,
    `variationWooId` INTEGER NULL,
    `sku` VARCHAR(191) NULL,
    `name` TEXT NOT NULL,
    `quantity` INTEGER NOT NULL,
    `subtotal` DECIMAL(12, 2) NOT NULL,
    `total` DECIMAL(12, 2) NOT NULL,

    INDEX `OrderItem_productWooId_idx`(`productWooId`),
    INDEX `OrderItem_sku_idx`(`sku`),
    UNIQUE INDEX `OrderItem_orderId_wooLineItemId_key`(`orderId`, `wooLineItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Refund` (
    `id` VARCHAR(191) NOT NULL,
    `wooId` INTEGER NOT NULL,
    `orderId` VARCHAR(191) NOT NULL,
    `amount` DECIMAL(12, 2) NOT NULL,
    `reason` TEXT NULL,
    `createdAtWoo` DATETIME(3) NOT NULL,
    `modifiedAtWoo` DATETIME(3) NULL,
    `deletedInWoo` BOOLEAN NOT NULL DEFAULT false,
    `syncedAt` DATETIME(3) NULL,
    `raw` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Refund_wooId_key`(`wooId`),
    INDEX `Refund_orderId_idx`(`orderId`),
    INDEX `Refund_createdAtWoo_idx`(`createdAtWoo`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Inquiry` (
    `id` VARCHAR(191) NOT NULL,
    `externalId` VARCHAR(191) NOT NULL,
    `formName` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `message` TEXT NULL,
    `payload` JSON NOT NULL,
    `status` ENUM('NEW', 'OPEN', 'WAITING', 'WON', 'CLOSED') NOT NULL DEFAULT 'NEW',
    `assigneeId` VARCHAR(191) NULL,
    `submittedAt` DATETIME(3) NOT NULL,
    `firstResponseAt` DATETIME(3) NULL,
    `closedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Inquiry_externalId_key`(`externalId`),
    INDEX `Inquiry_status_submittedAt_idx`(`status`, `submittedAt`),
    INDEX `Inquiry_contactId_idx`(`contactId`),
    INDEX `Inquiry_assigneeId_idx`(`assigneeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Note` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `inquiryId` VARCHAR(191) NULL,
    `body` TEXT NOT NULL,
    `authorId` VARCHAR(191) NOT NULL,
    `visibility` ENUM('INTERNAL', 'WOO_PRIVATE', 'WOO_CUSTOMER') NOT NULL DEFAULT 'INTERNAL',
    `wooNoteId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Note_contactId_idx`(`contactId`),
    INDEX `Note_orderId_idx`(`orderId`),
    INDEX `Note_inquiryId_idx`(`inquiryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Task` (
    `id` VARCHAR(191) NOT NULL,
    `title` TEXT NOT NULL,
    `dueAt` DATETIME(3) NULL,
    `contactId` VARCHAR(191) NULL,
    `orderId` VARCHAR(191) NULL,
    `inquiryId` VARCHAR(191) NULL,
    `assigneeId` VARCHAR(191) NOT NULL,
    `createdById` VARCHAR(191) NOT NULL,
    `doneAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `Task_assigneeId_doneAt_dueAt_idx`(`assigneeId`, `doneAt`, `dueAt`),
    INDEX `Task_contactId_idx`(`contactId`),
    INDEX `Task_orderId_idx`(`orderId`),
    INDEX `Task_inquiryId_idx`(`inquiryId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Activity` (
    `id` VARCHAR(191) NOT NULL,
    `contactId` VARCHAR(191) NOT NULL,
    `type` ENUM('ORDER_PLACED', 'ORDER_STATUS', 'REFUND', 'INQUIRY', 'NOTE', 'TASK_DONE', 'FIELD_EDIT') NOT NULL,
    `refId` VARCHAR(191) NULL,
    `summary` TEXT NOT NULL,
    `occurredAt` DATETIME(3) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Activity_contactId_occurredAt_idx`(`contactId`, `occurredAt`),
    INDEX `Activity_type_idx`(`type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncCursor` (
    `resource` VARCHAR(191) NOT NULL,
    `lastModifiedGmt` DATETIME(3) NULL,
    `consecutiveFailures` INTEGER NOT NULL DEFAULT 0,
    `lastSuccessAt` DATETIME(3) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`resource`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SyncRun` (
    `id` VARCHAR(191) NOT NULL,
    `resource` VARCHAR(191) NOT NULL,
    `mode` ENUM('INCREMENTAL', 'FULL') NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finishedAt` DATETIME(3) NULL,
    `fetched` INTEGER NOT NULL DEFAULT 0,
    `upserted` INTEGER NOT NULL DEFAULT 0,
    `markedDeleted` INTEGER NOT NULL DEFAULT 0,
    `error` TEXT NULL,

    INDEX `SyncRun_resource_startedAt_idx`(`resource`, `startedAt`),
    INDEX `SyncRun_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditLog` (
    `id` VARCHAR(191) NOT NULL,
    `userId` VARCHAR(191) NULL,
    `action` VARCHAR(191) NOT NULL,
    `entity` VARCHAR(191) NOT NULL,
    `entityId` VARCHAR(191) NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `AuditLog_userId_idx`(`userId`),
    INDEX `AuditLog_entity_entityId_idx`(`entity`, `entityId`),
    INDEX `AuditLog_at_idx`(`at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `RecoveryCode` ADD CONSTRAINT `RecoveryCode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invite` ADD CONSTRAINT `Invite_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Invite` ADD CONSTRAINT `Invite_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Contact` ADD CONSTRAINT `Contact_ownerId_fkey` FOREIGN KEY (`ownerId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactTag` ADD CONSTRAINT `ContactTag_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ContactTag` ADD CONSTRAINT `ContactTag_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `Tag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Order` ADD CONSTRAINT `Order_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `OrderItem` ADD CONSTRAINT `OrderItem_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Refund` ADD CONSTRAINT `Refund_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Inquiry` ADD CONSTRAINT `Inquiry_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Inquiry` ADD CONSTRAINT `Inquiry_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Note` ADD CONSTRAINT `Note_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Note` ADD CONSTRAINT `Note_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Note` ADD CONSTRAINT `Note_inquiryId_fkey` FOREIGN KEY (`inquiryId`) REFERENCES `Inquiry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Note` ADD CONSTRAINT `Note_authorId_fkey` FOREIGN KEY (`authorId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `Order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_inquiryId_fkey` FOREIGN KEY (`inquiryId`) REFERENCES `Inquiry`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_assigneeId_fkey` FOREIGN KEY (`assigneeId`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Task` ADD CONSTRAINT `Task_createdById_fkey` FOREIGN KEY (`createdById`) REFERENCES `User`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Activity` ADD CONSTRAINT `Activity_contactId_fkey` FOREIGN KEY (`contactId`) REFERENCES `Contact`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `AuditLog` ADD CONSTRAINT `AuditLog_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
