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
require_once dirname(__DIR__) . '/db_connect.php';

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
    $secret_key = $_ENV['JWT_SECRET_KEY'] ?? '';
    if (empty($secret_key)) throw new Exception("JWT Secret is not configured.");
    $decoded = JWT::decode($jwt, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) $input = [];
    $order_id = $input['order_id'] ?? ($_POST['order_id'] ?? '');
    $code = strtoupper(trim($input['code'] ?? ($_POST['code'] ?? '')));

    if (empty($order_id) || empty($code)) {
        http_response_code(400);
        echo json_encode(["message" => "Thiếu thông tin mã giảm giá hoặc đơn hàng!"]);
        exit();
    }

    $stmt = $conn->prepare("SELECT discount_rate FROM discount_codes WHERE code = ? AND is_active = TRUE");
    $stmt->bind_param("s", $code);
    $stmt->execute();
    $db_discount_rate = null;
    $stmt->bind_result($db_discount_rate);
    
    if (!$stmt->fetch()) {
        http_response_code(400);
        echo json_encode(["message" => "Mã giảm giá không hợp lệ hoặc đã hết hạn!"]);
        exit();
    }
    $discount_rate = floatval($db_discount_rate);
    $stmt->close();

    $is_cart = false;
    $order_ids = [];
    if (strpos($order_id, 'CART_') === 0) {
        $is_cart = true;
        $ids_str = str_replace("CART_", "", $order_id);
        $order_ids = array_filter(explode("_", $ids_str));
    } else {
        $order_ids = [$order_id];
    }

    $total_new_price = 0;
    $total_original_price = 0;
    $has_valid_order = false;

    foreach ($order_ids as $oid) {
        $oid_int = intval($oid);
        $stmt = $conn->prepare("SELECT id, course_name FROM orders WHERE id = ? AND user_id = ?");
        $stmt->bind_param("ii", $oid_int, $user_id);
        $stmt->execute();
        $db_order_id = $db_course_name = null;
        $stmt->bind_result($db_order_id, $db_course_name);
        
        if ($stmt->fetch()) {
            $has_valid_order = true;
            $stmt->close();

            $stmt = $conn->prepare("SELECT price FROM courses WHERE id = ?");
            $stmt->bind_param("s", $db_course_name);
            $stmt->execute();
            $db_original_price = null;
            $stmt->bind_result($db_original_price);
            $stmt->fetch();
            $original_price = intval($db_original_price);
            $stmt->close();

            $new_price = intval($original_price * (1 - $discount_rate));
            
            $update_stmt = $conn->prepare("UPDATE orders SET price = ? WHERE id = ?");
            $update_stmt->bind_param("ii", $new_price, $oid_int);
            $update_stmt->execute();
            $update_stmt->close();

            $total_original_price += $original_price;
            $total_new_price += $new_price;
        } else {
            $stmt->close();
        }
    }

    if (!$has_valid_order) {
        http_response_code(404);
        echo json_encode(["message" => "Đơn hàng không hợp lệ!"]);
        exit();
    }

    $memo = "ATTT " . ($is_cart ? "CART" . $user_id : $order_id);
    $account_name = "HOC VIEN COURSERA ATTT";
    $qr_url = "https://api.vietqr.io/image/MB-0999999999-qr_only.png?amount={$total_new_price}&addInfo=" . urlencode($memo) . "&accountName=" . urlencode($account_name);

    echo json_encode([
        "message" => "Áp dụng thành công! Đã giảm " . ($discount_rate * 100) . "%",
        "new_price" => $total_new_price,
        "original_price" => $total_original_price,
        "qr_url" => $qr_url
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(["message" => "Lỗi hệ thống khi áp dụng mã."]);
}