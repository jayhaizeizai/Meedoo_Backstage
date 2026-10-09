// Based on https://docs.volcengine.com/docs/82379/1299023?lang=zh (reviewed 2026-09-17).
// Product wording only: never display the provider's unfiltered message.
type Reason = readonly [zh: string, en: string];
const reasons: Record<string, Reason> = {
  "1026": ["内容审核未通过。MiniMax 拦截了此任务，但未说明是提示词、参考素材还是生成结果触发审核。如认为是误判，请凭任务编号联系平台核查。", "Content review failed. MiniMax blocked this task without specifying whether the prompt, reference media or generated output triggered moderation. Contact provider support with the task ID if this seems incorrect."],
  INPUT_MEDIA_UNREACHABLE: ["生成平台无法完整读取参考素材。请重新提交以同步素材；若仍失败，请联系管理员。", "The provider could not fully read the reference media. Submit again to sync the media; contact an administrator if it persists."],
  INPUT_UPLOAD_FAILED: ["参考素材同步到生成平台失败，尚未提交生成。请检查素材或联系管理员。", "Reference media could not be synced to the provider; generation was not submitted. Check the media or contact an administrator."],
  ModelNotOpen: ["该模型尚未开通，请联系管理员在火山方舟开通。", "This model is not activated. Ask an administrator to activate it in Ark."],
  "OperationDenied.ServiceNotOpen": ["模型服务尚未启用或暂不可用，请联系管理员检查。", "The model service is not enabled or available. Contact an administrator."],
  AuthenticationError: ["生成平台的密钥验证失败，请联系管理员检查配置。", "Provider authentication failed. Ask an administrator to check the API credentials."],
  InvalidAccountStatus: ["生成平台账号状态异常，请联系管理员检查。", "The provider account has an invalid status. Contact an administrator."],
  AccessDenied: ["账号无权访问该资源，请联系管理员检查权限。", "The account cannot access this resource. Ask an administrator to check permissions."],
  "OperationDenied.PermissionDenied": ["账号无权执行此操作，请联系管理员检查权限。", "The account cannot perform this operation. Contact an administrator."],
  AccountOverdueError: ["生成平台账号欠费，请联系管理员检查余额。", "The provider account has an overdue balance. Contact an administrator."],
  "OperationDenied.ServiceOverdue": ["生成平台账单逾期，请联系管理员处理。", "The provider account has an overdue bill. Contact an administrator."],
  "InvalidEndpointOrModel.NotFound": ["模型或接入点不存在，或当前账号无权访问。请联系管理员检查。", "The model or endpoint does not exist, or this account cannot access it. Contact an administrator."],
  "InvalidEndpointOrModel.ModelIDAccessDisabled": ["账号不支持直接使用模型 ID，请联系管理员配置有权限的接入点。", "This account requires an authorized endpoint instead of a model ID. Contact an administrator."],
  "InvalidEndpoint.ClosedEndpoint": ["模型接入点已关闭或暂不可用，请联系管理员检查。", "The model endpoint is closed or temporarily unavailable. Contact an administrator."],
  "InvalidParameter.TaskTypeConstraint": ["生成参数与模型识别的任务类型不兼容，请检查参数与输入素材。", "Generation settings are incompatible with the detected task type. Check the settings and inputs."],
  "InvalidParameter.TaskTypeMismatch": ["指定的任务类型与模型识别结果不一致，请检查提示词和素材。", "The requested task type differs from the detected type. Check the prompt and media."],
  "InvalidParameter.UnsupportedParameter": ["当前模型不支持所选参数，请检查生成设置。", "The selected model does not support a supplied parameter. Check generation settings."],
  "InvalidImageURL.EmptyURL": ["参考图片地址为空，请联系管理员检查。", "A reference image URL is empty. Contact an administrator."],
  "InvalidImageURL.InvalidFormat": ["平台无法解析参考图片，可能是格式不支持或文件损坏。请检查图片文件。", "The provider cannot decode an image. Check for unsupported format or damaged data."],
  SetLimitExceeded: ["已达到账号设置的模型用量上限，请联系管理员检查限额。", "The account's configured model usage limit has been reached. Contact an administrator."],
  QuotaExceeded: ["已达到平台额度或排队任务数量上限，请联系管理员核查具体限制。", "A provider quota or queued-task limit has been reached. Ask an administrator to check the applicable limit."],
  InflightBatchsizeExceeded: ["同时处理的任务已达到上限，请等待已有任务结束。", "The concurrent-task limit has been reached. Wait for existing tasks to finish."],
  ServerOverloaded: ["生成平台当前繁忙，请稍后再试。", "The generation provider is overloaded. Try again later."],
  RequestBurstTooFast: ["请求量增长过快，平台暂时限流，请稍后再试。", "A burst of requests triggered rate limiting. Try again later."],
  InternalServiceError: ["生成平台内部异常。若持续发生，请凭请求编号联系平台支持。", "The provider encountered an internal error. Contact support with the request ID if it persists."],
  ContentSecurityDetectionError: ["平台内容审核服务异常，请稍后再试或联系平台支持。", "The provider's content review service failed. Try later or contact support."],
};

export function seedanceErrorReason(code?: string): Reason {
  if (code && Object.hasOwn(reasons, code)) return reasons[code];
  const match = /^(Input|Output)(Text|Image|Video|Audio)SensitiveContentDetected(?:\.(\w+))?$/.exec(code || "");
  if (match) {
    const [, direction, media, subtype] = match;
    const names: Record<string, Reason> = {Text:["文本", "text"], Image:["图片", "image"], Video:["视频", "video"], Audio:["音频", "audio"]};
    const [zh, en] = names[media];
    const input = direction === "Input";
    const subject = (input ? "输入" : "生成的") + zh;
    const subjectEn = (input ? "input " : "generated ") + en;
    if (input && ["Image", "Video"].includes(media) && subtype === "PrivacyInformation")
      return [`平台判断${subject}可能包含真人，未通过审核。如认为是误判，请凭请求编号联系平台核查。`, `The provider flagged the ${subjectEn} as potentially containing a real person. If this seems incorrect, contact support with the request ID.`];
    if (subtype === "PolicyViolation")
      return [`平台判断${subject}可能涉及版权限制，未通过审核。请检查素材授权，或凭请求编号联系平台核查。`, `The provider flagged possible copyright restrictions in the ${subjectEn}. Check the rights to the material or contact support with the request ID.`];
    if (!input && media === "Image" && subtype === "DeepFake")
      return ["平台判断生成图片存在伪造内容风险，未通过审核。如有疑问，请联系平台核查。", "The generated image was flagged for possible forged content. Contact provider support if this seems incorrect."];
    return [`${subject}未通过平台内容审核。如认为是误判，请凭请求编号联系平台核查。`, `The ${subjectEn} did not pass the provider's content review. Contact support with the request ID if this seems incorrect.`];
  }
  if (/^(?:Input|Output)(?:Text|Image)RiskDetection$/.test(code || "") || /^SensitiveContentDetected(?:\.|$)/.test(code || ""))
    return ["输入或输出未通过平台内容审核，请凭错误码和请求编号核查。", "An input or output did not pass content review. Check the error code and request ID with support."];
  if (/^MissingParameter(?:\.|$)/.test(code || "")) return ["请求缺少必要参数，请联系管理员检查。", "A required request parameter is missing. Contact an administrator."];
  if (/^InvalidParameter(?:\.|$)/.test(code || "")) return ["生成请求的参数不符合平台要求，请检查下方相关参数或联系管理员。", "A generation parameter does not meet the provider's requirements. Check the parameter below or contact an administrator."];
  if (/^(?:RateLimitExceeded(?:\.|$)|(?:ModelAccount|APIAccount|Account).*RateLimitExceeded$)/.test(code || ""))
    return ["请求频率超过平台限制，请稍后再试。", "Requests exceeded the provider's rate limit. Try again later."];
  return ["生成平台返回了尚未收录的错误，请凭下方错误码和请求编号联系管理员核查。", "The provider returned an error without a mapped explanation. Contact an administrator with the code and request ID below."];
}
