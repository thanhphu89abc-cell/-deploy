<?php
ini_set('display_errors', 1);
error_reporting(E_ALL);

require 'db_connect.php';
require_once 'vendor/autoload.php';

use Firebase\JWT\JWT;
use Firebase\JWT\Key;

header('Content-Type: application/json; charset=utf-8');

// 1. Lấy vé (Token) từ trình duyệt gửi lên
$headers = apache_request_headers();
$authHeader = $headers['Authorization'] ?? ($headers['authorization'] ?? '');

if (empty($authHeader)) {
    http_response_code(401);
    die(json_encode(["message" => "Chưa đăng nhập (Thiếu Token)"]));
}

$token = str_replace('Bearer ', '', $authHeader);
// KHÓA NÀY PHẢI GIỐNG HỆT BÊN LOGIN.PHP
$secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';

try {
    // 2. Giải mã Token
    $decoded = JWT::decode($token, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

    // 3. Lấy thông tin user (DÙNG FULLNAME thay vì username để không bị sập)
    $stmt = $conn->prepare("SELECT id, email, fullname, role FROM users WHERE id = ?");
    $stmt->bind_param("i", $user_id);
    $stmt->execute();
    $result = $stmt->get_result();
    $user = $result->fetch_assoc();

    if (!$user) {
        http_response_code(401);
        die(json_encode(["message" => "Tài khoản không tồn tại"]));
    }

    // 4. Lấy danh sách đơn hàng (orders) để hiển thị trong Tài khoản
    $orders = [];
    // Dùng @ để bỏ qua lỗi nếu bảng orders chưa tồn tại hoặc sai cấu trúc
    $order_stmt = @$conn->prepare("SELECT * FROM orders WHERE user_id = ?");
    if ($order_stmt) {
        $order_stmt->bind_param("i", $user_id);
        $order_stmt->execute();
        $order_res = $order_stmt->get_result();
        while($row = $order_res->fetch_assoc()) {
            $orders[] = $row;
        }
    }

    // 5. Trả dữ liệu về cho coursera-script.js để hiển thị giao diện
    http_response_code(200);
    echo json_encode([
        "user" => $user,
        "orders" => $orders
    ]);

} catch (Exception $e) {
    // Bắt mọi lỗi liên quan đến Token hết hạn, sai khóa...
    http_response_code(401);
    echo json_encode(["message" => "Token hết hạn hoặc lỗi: " . $e->getMessage()]);
}
?>