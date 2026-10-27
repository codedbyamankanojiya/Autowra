import { Body, Controller, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type {
  PartnerEarningsResponse,
  PartnerJobDetail,
  PartnerJobsResponse,
  PartnerPayoutsResponse,
  PartnerProfile,
} from '@autowra/shared-types';
import {
  listPartnerJobsQuerySchema,
  partnerDocumentUploadSchema,
  partnerDutyStatusSchema,
  partnerEarningsQuerySchema,
  partnerIssueSchema,
  partnerJobActionSchema,
  partnerJobStatusSchema,
  partnerLocationSchema,
  partnerPhotoUploadSchema,
  partnerProfileUpdateSchema,
  partnerRegisterSchema,
  type ListPartnerJobsQueryInput,
  type PartnerDocumentUploadInput,
  type PartnerDutyStatusInput,
  type PartnerEarningsQueryInput,
  type PartnerIssueInput,
  type PartnerJobActionInput,
  type PartnerJobStatusInput,
  type PartnerLocationInput,
  type PartnerPhotoUploadInput,
  type PartnerProfileUpdateInput,
  type PartnerRegisterInput,
} from '@autowra/validation';
import { CurrentUser, Roles } from '../../common/decorators';
import type { AuthenticatedUser } from '../../common/types';
import { zodBody, zodQuery } from '../../common/zod-validation.pipe';
import { PartnerService } from './partner.service';

/**
 * The partner app's API.
 *
 * Everything here requires a `PARTNER` session; the partner's own service layer enforces
 * document-level authorisation, so a partner can only ever reach their own profile, jobs and
 * money. Amounts in responses are the server's figures - nothing the app sends is trusted.
 */
@ApiTags('partner')
@ApiBearerAuth()
@Roles('PARTNER')
@Controller('partner')
export class PartnerController {
  constructor(private readonly partners: PartnerService) {}

  @Get('profile')
  profile(@CurrentUser() user: AuthenticatedUser): Promise<PartnerProfile> {
    return this.partners.getProfile(user.id);
  }

  /** Creates or updates the draft registration. Locked once submitted. */
  @Post('register')
  register(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(partnerRegisterSchema)) input: PartnerRegisterInput,
  ): Promise<PartnerProfile> {
    return this.partners.register(user.id, input);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(partnerProfileUpdateSchema)) input: PartnerProfileUpdateInput,
  ): Promise<PartnerProfile> {
    return this.partners.updateProfile(user.id, input);
  }

  /** Uploads private KYC evidence; re-uploading replaces the file and reopens its review. */
  @Post('documents')
  uploadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(partnerDocumentUploadSchema)) input: PartnerDocumentUploadInput,
  ): Promise<PartnerProfile> {
    return this.partners.uploadDocument(user.id, input);
  }

  /**
   * Serves a partner's own document. KYC files never travel through the public file route,
   * so this authenticated endpoint is the only way back to them.
   */
  @Get('documents/:documentId')
  async downloadDocument(
    @CurrentUser() user: AuthenticatedUser,
    @Param('documentId') documentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.partners.readDocument(user.id, documentId);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`);
    response.setHeader('Cache-Control', 'private, no-store');
    response.end(file.body);
  }

  /** Sends the application for verification once the profile and documents are complete. */
  @Post('submit')
  submit(@CurrentUser() user: AuthenticatedUser): Promise<PartnerProfile> {
    return this.partners.submitApplication(user.id);
  }

  @Post('duty')
  duty(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(partnerDutyStatusSchema)) input: PartnerDutyStatusInput,
  ): Promise<PartnerProfile> {
    return this.partners.setDutyStatus(user.id, input);
  }

  /** Periodic location heartbeat while the partner is online. */
  @Post('location')
  location(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(partnerLocationSchema)) input: PartnerLocationInput,
  ): Promise<{ success: boolean }> {
    return this.partners.pushLocation(user.id, input);
  }

  @Get('jobs')
  jobs(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(listPartnerJobsQuerySchema)) query: ListPartnerJobsQueryInput,
  ): Promise<PartnerJobsResponse> {
    return this.partners.listJobs(user.id, query);
  }

  @Get('jobs/:jobId')
  job(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
  ): Promise<PartnerJobDetail> {
    return this.partners.getJob(user.id, jobId);
  }

  @Post('jobs/:jobId/accept')
  acceptJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
    @Body(zodBody(partnerJobActionSchema)) input: PartnerJobActionInput,
  ): Promise<PartnerJobDetail> {
    return this.partners.acceptJob(user.id, jobId, input);
  }

  @Post('jobs/:jobId/reject')
  rejectJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
    @Body(zodBody(partnerJobActionSchema)) input: PartnerJobActionInput,
  ): Promise<{ success: boolean }> {
    return this.partners.rejectJob(user.id, jobId, input);
  }

  /** Advances the job through the legal transitions only. */
  @Post('jobs/:jobId/status')
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
    @Body(zodBody(partnerJobStatusSchema)) input: PartnerJobStatusInput,
  ): Promise<PartnerJobDetail> {
    return this.partners.updateJobStatus(user.id, jobId, input);
  }

  @Post('jobs/:jobId/issue')
  reportIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
    @Body(zodBody(partnerIssueSchema)) input: PartnerIssueInput,
  ): Promise<PartnerJobDetail> {
    return this.partners.reportIssue(user.id, jobId, input);
  }

  /** Before/after evidence photos. */
  @Post('jobs/:jobId/photos')
  uploadPhoto(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId') jobId: string,
    @Body(zodBody(partnerPhotoUploadSchema)) input: PartnerPhotoUploadInput,
  ): Promise<PartnerJobDetail> {
    return this.partners.uploadJobPhoto(user.id, jobId, input);
  }

  @Get('earnings')
  earnings(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(partnerEarningsQuerySchema)) query: PartnerEarningsQueryInput,
  ): Promise<PartnerEarningsResponse> {
    return this.partners.earnings(user.id, query);
  }

  @Get('payouts')
  payouts(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(partnerEarningsQuerySchema)) query: PartnerEarningsQueryInput,
  ): Promise<PartnerPayoutsResponse> {
    return this.partners.payouts(user.id, query);
  }
}
