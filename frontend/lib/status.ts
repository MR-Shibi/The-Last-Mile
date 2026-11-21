/** Plain-language mapping of the REAL backend case statuses (backend/app/api/receipts.py STATUS_BADGE).
 * The UI never invents statuses; it only groups the server's ones. */
export type Tone = "safe" | "review" | "danger" | "neutral";
export type Bucket = "pending" | "review" | "approved" | "not_approved";

export const STATUS_BUCKET: Record<string, Bucket> = {
  SUBMITTED: "pending",
  ASK_MORE_PROOF: "pending",
  OFFICER_REQUESTED_PROOF: "pending",
  ESCALATE_HUMAN: "review",
  AUTO_RECOMMEND: "review",
  OFFICER_APPROVED: "approved",
  PAID: "approved",
  OFFICER_REJECTED: "not_approved",
};

export const BUCKET_LABEL: Record<Bucket, { en: string; ur: string; tone: Tone }> = {
  pending: { en: "Pending", ur: "زیرِ التوا", tone: "review" },
  review: { en: "Under review", ur: "زیرِ جائزہ", tone: "review" },
  approved: { en: "Approved / Completed", ur: "منظور / مکمل", tone: "safe" },
  not_approved: { en: "Not approved (can appeal)", ur: "منظور نہیں (اپیل ممکن)", tone: "danger" },
};

/** Receipt badge colour from the server -> locked palette tone. */
export const COLOR_TONE: Record<string, Tone> = { green: "safe", yellow: "review", blue: "review", red: "danger" };

/** 4-stage progress timeline: 1 Submitted -> 2 Under review -> 3 Verification completed -> 4 Final decision.
 * Returns how many stages are complete (the next one is "current"). */
export function stagesDone(status: string | undefined | null): number {
  switch (status) {
    case "SUBMITTED":
      return 1;
    case "ESCALATE_HUMAN":
    case "ASK_MORE_PROOF":
    case "OFFICER_REQUESTED_PROOF":
      return 1; // review in progress
    case "AUTO_RECOMMEND":
      return 3; // checks done, waiting for the officer's final decision
    case "OFFICER_APPROVED":
    case "PAID":
    case "OFFICER_REJECTED":
      return 4;
    default:
      return 1;
  }
}

export const STAGES = [
  { en: "Application submitted", ur: "درخواست جمع ہو گئی",
    d_en: "We received your application and gave you a Parchi with an ID and PIN.", d_ur: "ہمیں آپ کی درخواست مل گئی اور آپ کو آئی ڈی اور پن والی پرچی دی گئی۔" },
  { en: "Application under review", ur: "درخواست زیرِ جائزہ",
    d_en: "Your details and documents are being checked. If anything is unclear, an officer looks at it — you are never auto-rejected.", d_ur: "آپ کی معلومات اور کاغذات جانچے جا رہے ہیں۔ کوئی بات واضح نہ ہو تو افسر خود دیکھتا ہے — آپ کو خودکار طور پر مسترد نہیں کیا جاتا۔" },
  { en: "Verification completed", ur: "تصدیق مکمل",
    d_en: "All checks are finished. The case is with the officer for the final decision.", d_ur: "تمام جانچ مکمل۔ کیس حتمی فیصلے کے لیے افسر کے پاس ہے۔" },
  { en: "Final decision", ur: "حتمی فیصلہ",
    d_en: "An officer has decided. If not approved, you can appeal.", d_ur: "افسر نے فیصلہ کر دیا۔ منظور نہ ہونے پر آپ اپیل کر سکتی ہیں۔" },
] as const;
