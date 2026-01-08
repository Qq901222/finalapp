/*
  Warnings:

  - You are about to drop the `Split` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `Split` DROP FOREIGN KEY `Split_groupId_fkey`;

-- DropForeignKey
ALTER TABLE `Split` DROP FOREIGN KEY `Split_paidById_fkey`;

-- DropForeignKey
ALTER TABLE `SplitParticipant` DROP FOREIGN KEY `SplitParticipant_splitId_fkey`;

-- DropTable
DROP TABLE `Split`;

-- CreateTable
CREATE TABLE `splits` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `amount` DOUBLE NOT NULL,
    `description` VARCHAR(191) NULL,
    `dueType` VARCHAR(191) NOT NULL,
    `settled` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `paidById` INTEGER NULL,
    `groupId` INTEGER NULL,
    `originalAmount` DOUBLE NULL,
    `originalCurrency` VARCHAR(191) NULL,
    `exchangeRate` DOUBLE NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `splits` ADD CONSTRAINT `splits_paidById_fkey` FOREIGN KEY (`paidById`) REFERENCES `User`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `splits` ADD CONSTRAINT `splits_groupId_fkey` FOREIGN KEY (`groupId`) REFERENCES `groups`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `SplitParticipant` ADD CONSTRAINT `SplitParticipant_splitId_fkey` FOREIGN KEY (`splitId`) REFERENCES `splits`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
