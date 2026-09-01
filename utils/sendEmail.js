const nodemailer = require('nodemailer');

/**
 * Send Email utility using Nodemailer
 * @param {Object} options Options object containing { to, subject, html, text, resetLink }
 */
const sendEmail = async (options) => {
  const emailUser = process.env.EMAIL_USER;
  const emailPass = process.env.EMAIL_PASS;

  // Always log reset link to backend console for developer visibility & offline testing
  if (options.resetLink) {
    console.log('\n======================================================');
    console.log(`[PASSWORD RESET EMAIL] Sent to: ${options.to}`);
    console.log(`[RESET LINK]: ${options.resetLink}`);
    console.log('======================================================\n');
  }

  // Check if real credentials are set (not default placeholders)
  const isPlaceholder = !emailUser || 
    !emailPass || 
    emailUser.includes('your_email@gmail.com') || 
    emailPass.includes('your_google_app_password');

  if (isPlaceholder) {
    console.log('[sendEmail]: EMAIL_USER / EMAIL_PASS in .env are placeholders. Email delivery simulated via console log.');
    return { success: true, simulated: true };
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: emailUser,
      pass: emailPass
    }
  });

  const mailOptions = {
    from: `"NexusCRM Security" <${emailUser}>`,
    to: options.to,
    subject: options.subject || 'NexusCRM Password Reset Request',
    text: options.text || `Reset your password by following this link: ${options.resetLink}`,
    html: options.html || `
      <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #E2E8F0; border-radius: 8px; background-color: #FFFFFF;">
        <div style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #F1F5F9;">
          <h2 style="color: #2563EB; margin: 0;">NexusCRM</h2>
          <p style="color: #64748B; font-size: 14px; margin-top: 4px;">Enterprise Management System</p>
        </div>
        <div style="padding: 24px 0;">
          <h3 style="color: #1E293B; margin-top: 0;">Password Reset Request</h3>
          <p style="color: #475569; font-size: 15px; line-height: 1.6;">
            We received a request to reset the password for your NexusCRM account associated with <strong>${options.to}</strong>.
          </p>
          <p style="color: #475569; font-size: 15px; line-height: 1.6;">
            Click the button below to set a new password. This link is valid for <strong>15 minutes</strong>.
          </p>
          <div style="text-align: center; margin: 32px 0;">
            <a href="${options.resetLink}" style="background-color: #2563EB; color: #FFFFFF; text-decoration: none; padding: 12px 28px; border-radius: 6px; font-weight: 600; font-size: 15px; display: inline-block;">
              Reset Password
            </a>
          </div>
          <p style="color: #64748B; font-size: 13px; line-height: 1.5;">
            If you did not request a password reset, you can safely ignore this email. Your password will remain unchanged.
          </p>
          <p style="color: #94A3B8; font-size: 12px; word-break: break-all; margin-top: 20px;">
            If the button doesn't work, copy and paste this link into your web browser:<br />
            <a href="${options.resetLink}" style="color: #2563EB;">${options.resetLink}</a>
          </p>
        </div>
        <div style="text-align: center; padding-top: 16px; border-top: 1px solid #F1F5F9; color: #94A3B8; font-size: 12px;">
          &copy; ${new Date().getFullYear()} NexusCRM. All rights reserved.
        </div>
      </div>
    `
  };

  try {
    const info = await transporter.sendMail(mailOptions);
    console.log(`[sendEmail]: Email sent successfully to ${options.to}. MessageId: ${info.messageId}`);
    return { success: true, info };
  } catch (error) {
    console.error('[sendEmail Error]:', error);
    // Don't throw error to prevent breaking user flow, but return failure details
    return { success: false, error: error.message };
  }
};

module.exports = sendEmail;
