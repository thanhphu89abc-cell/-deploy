<?php
// forgot_password.php
ob_start();
ini_set('display_errors', 0);
error_reporting(E_ALL);

require 'db_connect.php';

header('Content-Type: application/json; charset=utf-8');

/**
 * Hàm gửi OTP giả lập (hoặc kết nối SMTP)
 */
function sendEmail($email, $otp) {
    // Nếu bạn có cấu hình SMTP như trong app.py, hãy tích hợp PHPMailer tại đây
    // Ở đây tôi trả về true để giả lập đã gửi thành công
    return true; 
}

$input = json_decode(file_get_contents('php://input'), true);
$email = trim($input['email'] ?? ($_POST['email'] ?? ''));

if (empty($email) || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Email không hợp lệ!"]);
    exit();
}

/** @var mysqli $conn */
$stmt = $conn->prepare("SELECT id FROM users WHERE email = ?");
$stmt->bind_param("s", $email);
$stmt->execute();
if (!$stmt->fetch()) {
    $stmt->close();
    http_response_code(404);
    echo json_encode(["status" => "error", "message" => "Email không tồn tại trong hệ thống!"]);
    exit();
}
$stmt->close();

// Tạo mã OTP
$otp = strval(random_int(100000, 999999));
$expires_at = date('Y-m-d H:i:s', strtotime('+15 minutes'));

// Lưu vào bảng otp_codes (Đảm bảo bảng này đã tồn tại trong DB)
$stmt = $conn->prepare("INSERT INTO otp_codes (email, otp, expires_at) VALUES (?, ?, ?)");
$stmt->bind_param("sss", $email, $otp, $expires_at);

if ($stmt->execute()) {
    // Gửi email thực tế hoặc log lại để test
    if (sendEmail($email, $otp)) {
        echo json_encode(["status" => "success", "message" => "Mã OTP đã được gửi tới email của bạn."]);
    } else {
        echo json_encode(["status" => "error", "message" => "Không thể gửi email."]);
    }
} else {
    http_response_code(500);
    echo json_encode(["status" => "error", "message" => "Lỗi hệ thống khi tạo OTP."]);
}

$stmt->close();
$conn->close();
?>