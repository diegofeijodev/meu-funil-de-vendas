import { IsIn, IsUUID } from 'class-validator';

export class DecideApprovalDto {
  @IsUUID() approvalId!: string;
  @IsIn(['approved', 'rejected']) decision!: 'approved' | 'rejected';
}
