import nodemailer from "nodemailer";

async function main() {
  const transporter = nodemailer.createTransport({
    host: "smtp.office365.com",
    port: 587,
    secure: false,
    auth: {
      user: "info@supportbiz.in",
      pass: "Hyderabad@7999",
    },
  });

  const info = await transporter.sendMail({
    from: '"Support Biz" <info@supportbiz.in>',
    to: "harshas379@gmail.com",
    subject: "SMTP Test",
    text: "SMTP working",
  });

  console.log(info);
}

main().catch(console.error);