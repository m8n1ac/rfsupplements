-- AlterTable
ALTER TABLE `Affiliate` MODIFY `paidCommission` DECIMAL(14, 4) NOT NULL DEFAULT 0,
    MODIFY `unpaidCommission` DECIMAL(14, 4) NOT NULL DEFAULT 0,
    MODIFY `rejectedCommission` DECIMAL(14, 4) NOT NULL DEFAULT 0,
    MODIFY `referredRevenue` DECIMAL(14, 4) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE `Referral` MODIFY `orderAmount` DECIMAL(14, 4) NOT NULL,
    MODIFY `commissionAmount` DECIMAL(14, 4) NOT NULL;
