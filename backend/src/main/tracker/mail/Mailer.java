package com.workchat.tracker.mail;

import jakarta.mail.Authenticator;
import jakarta.mail.Message;
import jakarta.mail.MessagingException;
import jakarta.mail.PasswordAuthentication;
import jakarta.mail.Session;
import jakarta.mail.Transport;
import jakarta.mail.internet.InternetAddress;
import jakarta.mail.internet.MimeMessage;

import java.util.Properties;

public final class Mailer {
    private final String host;
    private final int port;
    private final String username;
    private final String password;

    public Mailer(String host, int port, String username, String password) {
        this.host = host;
        this.port = port;
        this.username = username;
        this.password = password;
    }

    public void sendOtpCode(String to, String code, int ttlMinutes) throws MessagingException {
        Properties props = new Properties();
        props.put("mail.smtp.host", host);
        props.put("mail.smtp.port", String.valueOf(port));
        props.put("mail.smtp.auth", "true");
        props.put("mail.smtp.starttls.enable", "true");
        props.put("mail.smtp.connectiontimeout", "10000");
        props.put("mail.smtp.timeout", "15000");

        Session session = Session.getInstance(props, new Authenticator() {
            @Override
            protected PasswordAuthentication getPasswordAuthentication() {
                return new PasswordAuthentication(username, password);
            }
        });

        MimeMessage msg = new MimeMessage(session);
        try {
            msg.setFrom(new InternetAddress(username, "WorkChat", "UTF-8"));
        } catch (Exception e) {
            msg.setFrom(new InternetAddress(username));
        }
        msg.setRecipients(Message.RecipientType.TO, InternetAddress.parse(to, false));
        msg.setSubject("[WorkChat] Mã xác thực OTP của bạn", "UTF-8");
        msg.setText(
                "Chào bạn,\n\n"
                        + "Mã xác thực (OTP) của bạn là: " + code + "\n\n"
                        + "Mã có hiệu lực trong " + ttlMinutes + " phút. Vui lòng không chia sẻ mã này với bất kỳ ai.\n\n"
                        + "Nếu bạn không thực hiện yêu cầu này, hãy bỏ qua email này.\n\n"
                        + "— WorkChat",
                "UTF-8"
        );
        Transport.send(msg);
    }
}