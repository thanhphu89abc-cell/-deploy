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
require 'vendor/autoload.php';

header('Content-Type: application/json; charset=utf-8');

$authHeader = isset($_SERVER['HTTP_AUTHORIZATION']) ? $_SERVER['HTTP_AUTHORIZATION'] : '';
if (!$authHeader && function_exists('apache_request_headers')) {
    $headers = apache_request_headers();
    $authHeader = isset($headers['Authorization']) ? $headers['Authorization'] : '';
}

if (!preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
    http_response_code(401);
    echo json_encode(["message" => "Phiên làm việc hết hạn!"]);
    exit();
}

try {
    $jwt = $matches[1];
    $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
    $decoded = JWT::decode($jwt, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) $input = [];
    $course_id = $input['course_id'] ?? ($_POST['course_id'] ?? '');

    $stmt = $conn->prepare("SELECT title, price FROM courses WHERE id = ?");
    $stmt->bind_param("s", $course_id);
    $stmt->execute();
    $db_title = $db_price = null;
    $stmt->bind_result($db_title, $db_price);
    
    if (!$stmt->fetch()) {
        http_response_code(404);
        echo json_encode(["message" => "Khóa học không tồn tại!"]);
        exit();
    }
    $course_title = $db_title;
    $price = intval($db_price);
    $stmt->close();

    $stmt = $conn->prepare("SELECT id FROM orders WHERE user_id = ? AND course_name = ?");
    $stmt->bind_param("is", $user_id, $course_id);
    $stmt->execute();
    $db_order_id = null;
    $stmt->bind_result($db_order_id);
    
    if (!$stmt->fetch()) {
        $stmt->close();
        $stmt = $conn->prepare("INSERT INTO orders (user_id, course_name, price, current_step, created_at) VALUES (?, ?, ?, 1, NOW())");
        $stmt->bind_param("isi", $user_id, $course_id, $price);
        $stmt->execute();
        $order_id = $conn->insert_id;
    } else {
        $order_id = $db_order_id;
    }
    $stmt->close();

    $memo = "ATTT " . $order_id;
    $account_name = "HOC VIEN COURSERA ATTT";
    $qr_url = "https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={$price}&addInfo=" . urlencode($memo) . "&accountName=" . urlencode($account_name);

    echo json_encode([
        "status" => "PENDING", "course_title" => $course_title, "price" => $price,
        "memo" => $memo, "qr_url" => $qr_url, "order_id" => $order_id
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["message" => "Lỗi xử lý cổng thanh toán."]);
}