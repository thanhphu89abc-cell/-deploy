<?php
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
ini_set('display_errors', 0);
error_reporting(0);
register_shutdown_function(function() {
    $error = error_get_last();
    if ($error !== null && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
        http_response_code(500);
        echo json_encode(["status" => "error", "message" => "Lỗi sập PHP: " . $error['message'] . " tại dòng " . $error['line']]);
        exit;
    }
});
/** @var mysqli $conn */
require 'db_connect.php';

if (!file_exists('vendor/autoload.php')) {
    http_response_code(500);
    die(json_encode(["message" => "Thiếu thư viện! Hãy chạy lệnh 'composer require firebase/php-jwt' trong thư mục backend."]));
}
require_once 'vendor/autoload.php';

header('Content-Type: application/json; charset=utf-8');

// Lấy Token từ Header
$authHeader = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
if (!$authHeader && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    $authHeader = isset($headers['Authorization']) ? $headers['Authorization'] : '';
}

if (!preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
    http_response_code(401);
    echo json_encode(["message" => "Không tìm thấy Token"]);
    exit();
}

try {
    $jwt = $matches[1];
    $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
    $decoded = JWT::decode($jwt, new Key($secret_key, 'HS256'));
    
    // Lấy thông tin user
    $stmt = $conn->prepare("SELECT id, username, email, role, DATE_FORMAT(created_at, '%d/%m/%Y') as created_at FROM users WHERE id = ?");
    $stmt->bind_param("i", $decoded->user_id);
    $stmt->execute();
    $db_id = $db_fullname = $db_email = $db_role = $db_created_at = null;
    $stmt->bind_result($db_id, $db_fullname, $db_email, $db_role, $db_created_at);
    $user = null;
    if ($stmt->fetch()) {
        $user = [
            'id' => $db_id,
            'fullname' => $db_fullname,
            'email' => $db_email,
            'role' => $db_role,
            'created_at' => $db_created_at
        ];
    }
    $stmt->close();
    
    // Lấy đơn hàng
    $order_stmt = $conn->prepare("SELECT id, course_name, price, current_step, DATE_FORMAT(created_at, '%d/%m/%Y %H:%i') as created_at FROM orders WHERE user_id = ? ORDER BY id DESC");
    $order_stmt->bind_param("i", $decoded->user_id);
    $order_stmt->execute();
    $o_id = $o_course_name = $o_price = $o_current_step = $o_created_at = null;
    $order_stmt->bind_result($o_id, $o_course_name, $o_price, $o_current_step, $o_created_at);
    $orders = [];
    while ($order_stmt->fetch()) {
        $orders[] = [
            'id' => $o_id,
            'course_name' => $o_course_name,
            'price' => $o_price,
            'current_step' => $o_current_step,
            'created_at' => $o_created_at
        ];
    }
    $order_stmt->close();

    echo json_encode([
        "user" => $user,
        "orders" => $orders
    ]);
} catch (Exception $e) {
    http_response_code(401);
    echo json_encode(["message" => "Phiên đăng nhập hết hạn: " . $e->getMessage()]);
}