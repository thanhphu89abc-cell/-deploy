<?php
ob_start();

ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');

set_exception_handler(function (Throwable $e) {
    if (ob_get_level()) ob_clean();
    http_response_code(500);
    echo json_encode([
        "status" => "error", 
        "message" => "Lỗi ngoại lệ PHP: " . $e->getMessage()
    ], JSON_UNESCAPED_UNICODE);
    exit;
});

// Bắt các lỗi sập nguồn nặng nhất
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        if (ob_get_level()) ob_clean();
        http_response_code(500);
        echo json_encode([
            "status" => "error", 
            "message" => "Lỗi sập PHP: " . $error['message'] . " (Dòng " . $error['line'] . ")"
        ]);
        exit;
    }
});

require 'db_connect.php';

// Kiểm tra thư viện JWT
if (!file_exists('vendor/autoload.php')) {
    if (ob_get_level()) ob_clean();
    http_response_code(500);
    die(json_encode(["status" => "error", "message" => "Thiếu thư viện JWT! Hãy mở Terminal gõ 'composer require firebase/php-jwt'"]));
}
require_once 'vendor/autoload.php';
use Firebase\JWT\JWT;

// Nhận dữ liệu từ form HTML
$input = json_decode(file_get_contents('php://input'), true);
if (!is_array($input)) $input = [];
$email    = trim($input['email'] ?? ($_POST['email'] ?? ''));
$password = $input['password'] ?? ($_POST['password'] ?? '');

if (empty($email) || empty($password)) {
    if (ob_get_level()) ob_clean();
    http_response_code(400);
    echo json_encode(["status" => "error", "message" => "Vui lòng nhập email và mật khẩu!"]);
    exit();
}

// Gọi đúng cột username và password
$stmt = $conn->prepare("SELECT id, email, username, role, password FROM users WHERE email = ?");
if (!$stmt) {
    if (ob_get_level()) ob_clean();
    http_response_code(500);
    die(json_encode(["status" => "error", "message" => "Lỗi SQL: " . $conn->error]));
}

$stmt->bind_param("s", $email);
$stmt->execute();
$stmt->bind_result($db_id, $db_email, $db_username, $db_role, $db_password);

$response = [];
if ($stmt->fetch()) {
    // So sánh mật khẩu bằng chữ thường
    if ($password === $db_password) {
        $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
        $payload = [
            'user_id' => $db_id,
            'email' => $db_email,
            'username' => $db_username,
            'role' => $db_role,
            'exp' => time() + (24 * 60 * 60)
        ];
        $jwt = JWT::encode($payload, $secret_key, 'HS256');

        http_response_code(200);
        $response = [
            "status" => "success",
            "message" => "Đăng nhập thành công!",
            "token" => $jwt,
            "user" => [
                "username" => $db_username,
                "email" => $db_email,
                "role" => $db_role
            ]
        ];
    } else {
        http_response_code(401);
        $response = ["status" => "error", "message" => "Sai mật khẩu!"];
    }
} else {
    http_response_code(401);
    $response = ["status" => "error", "message" => "Không tìm thấy tài khoản email này!"];
}

$stmt->close();
$conn->close();

if (ob_get_level()) ob_clean();
echo json_encode($response, JSON_UNESCAPED_UNICODE);
exit();