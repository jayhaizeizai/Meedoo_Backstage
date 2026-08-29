import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/server-auth";
import { isApprover,listReviewRecords } from "../../../lib/approvals";
export const dynamic="force-dynamic";
export async function GET(){const user=await getCurrentUser();if(!user)return NextResponse.json({success:false},{status:401});if(!await isApprover(user.openId))return NextResponse.json({success:false,message:"Approver access required."},{status:403});return NextResponse.json({success:true,...await listReviewRecords(user,true)});}
