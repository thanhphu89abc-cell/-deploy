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
    echo json_encode(["message" => "Không tìm thấy Token"]);
    exit();
}

try {
    $jwt = $matches[1];
    $secret_key = 'coursera_advanced_secure_key_32_chars_long_2026_authentication_key!';
    $decoded = JWT::decode($jwt, new Key($secret_key, 'HS256'));
    $user_id = $decoded->user_id;

    // 1. Lấy danh sách các bài học đã hoàn thành
    $completed_lessons = [];
    $prog_stmt = $conn->prepare("SELECT lesson_id FROM user_progress WHERE user_id = ?");
    if ($prog_stmt) {
        $prog_stmt->bind_param("i", $user_id);
        $prog_stmt->execute();
        $lesson_id = null;
        $prog_stmt->bind_result($lesson_id);
        while ($prog_stmt->fetch()) { $completed_lessons[] = $lesson_id; }
        $prog_stmt->close();
    }

    // 2. Lấy danh sách khóa học đã mua (current_step = 3)
    $unlocked_courses = [];
    $order_stmt = $conn->prepare("SELECT course_name FROM orders WHERE user_id = ? AND current_step = 3");
    if ($order_stmt) {
        $order_stmt->bind_param("i", $user_id);
        $order_stmt->execute();
        $course_name = null;
        $order_stmt->bind_result($course_name);
        while ($order_stmt->fetch()) { $unlocked_courses[] = $course_name; }
        $order_stmt->close();
    }

    // 3. Lấy dữ liệu khóa học
    $courses = [];
    $res_courses = $conn->query("SELECT * FROM courses");
    
    while ($c = $res_courses->fetch_assoc()) {
        $course = [
            "id" => $c['id'],
            "title" => $c['title'],
            "original_price" => $c['original_price'],
            "price" => $c['price'],
            "badge" => $c['badge'],
            "color" => $c['color'],
            "icon" => $c['icon'],
            "lock_status" => in_array($c['id'], $unlocked_courses) ? "UNLOCKED" : "LOCKED",
            "weeks" => []
        ];

        $res_weeks = $conn->query("SELECT * FROM course_weeks WHERE course_id = '" . $conn->real_escape_string($c['id']) . "' ORDER BY week_number ASC");
        while ($w = $res_weeks->fetch_assoc()) {
            $week = [ "week_number" => $w['week_number'], "title" => $w['title'], "items" => [] ];

            $res_lessons = $conn->query("SELECT * FROM lessons WHERE week_id = " . $w['id'] . " ORDER BY id ASC");
            while ($l = $res_lessons->fetch_assoc()) {
                $lesson = [
                    "id" => (string)$l['id'],
                    "type" => $l['type'],
                    "title" => $l['title'],
                    "duration" => $l['duration'],
                    "videoSrc" => $l['video_url'],
                    "description" => $l['description'],
                    "completed" => in_array($l['id'], $completed_lessons),
                    "quiz" => null
                ];
                if (!empty($l['quiz_question'])) {
                    $lesson['quiz'] = [
                        "question" => $l['quiz_question'],
                        "options" => [ ["v" => "a", "t" => $l['quiz_option_a']], ["v" => "b", "t" => $l['quiz_option_b']] ],
                        "correct" => $l['quiz_correct_answer']
                    ];
                }
                $week['items'][] = $lesson;
            }
            $course['weeks'][] = $week;
        }
        $courses[] = $course;
    }
    echo json_encode(["courses" => $courses]);
} catch (Exception $e) {
    http_response_code(401);
    echo json_encode(["message" => "Phiên đăng nhập hết hạn: " . $e->getMessage()]);
}